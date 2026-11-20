package service

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"

	"learnwords/internal/auth"
	"learnwords/internal/domain"
)

// --- fakes: the same rules as the postgres repositories, in memory ----------------------------

type memLogins struct {
	mu   sync.Mutex
	rows map[string]*domain.TelegramLogin
}

func newMemLogins() *memLogins { return &memLogins{rows: map[string]*domain.TelegramLogin{}} }

func (m *memLogins) Create(_ context.Context, l domain.TelegramLogin, now time.Time) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	for code, r := range m.rows {
		if !r.ExpiresAt.After(now) {
			delete(m.rows, code)
		}
	}
	if _, ok := m.rows[l.Code]; ok {
		return domain.ErrAlreadyExists
	}
	l.Status = domain.LoginPending
	m.rows[l.Code] = &l
	return nil
}

func (m *memLogins) Get(_ context.Context, code string) (domain.TelegramLogin, bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if l, ok := m.rows[code]; ok {
		return *l, true, nil
	}
	return domain.TelegramLogin{}, false, nil
}

func (m *memLogins) Ask(_ context.Context, code string, chatID int64, now time.Time) (domain.TelegramLogin, bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	l, ok := m.rows[code]
	if !ok || l.Status != domain.LoginPending || !now.Before(l.ExpiresAt) {
		return domain.TelegramLogin{}, false, nil
	}
	l.Status, l.ChatID = domain.LoginAsked, &chatID
	return *l, true, nil
}

func (m *memLogins) Decide(_ context.Context, code string, chatID int64, now time.Time, status string, userID *uuid.UUID, newUser bool) (bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	l, ok := m.rows[code]
	if !ok || l.Status != domain.LoginAsked || l.ChatID == nil || *l.ChatID != chatID || !now.Before(l.ExpiresAt) {
		return false, nil
	}
	l.Status, l.UserID, l.NewUser = status, userID, newUser
	return true, nil
}

func (m *memLogins) Collect(_ context.Context, hash []byte, now time.Time) (uuid.UUID, bool, bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, l := range m.rows {
		if bytes.Equal(l.SecretHash, hash) && l.Status == domain.LoginConfirmed && now.Before(l.ExpiresAt) && l.UserID != nil {
			l.Status = domain.LoginUsed
			return *l.UserID, l.NewUser, true, nil
		}
	}
	return uuid.Nil, false, false, nil
}

func (m *memLogins) BySecret(_ context.Context, hash []byte) (domain.TelegramLogin, bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, l := range m.rows {
		if bytes.Equal(l.SecretHash, hash) {
			return *l, true, nil
		}
	}
	return domain.TelegramLogin{}, false, nil
}

type memLoginUsers struct {
	mu       sync.Mutex
	byID     map[uuid.UUID]*domain.User
	chat     map[int64]uuid.UUID
	profiles map[uuid.UUID]domain.TelegramProfile
	creates  int
}

func newMemLoginUsers() *memLoginUsers {
	return &memLoginUsers{byID: map[uuid.UUID]*domain.User{}, chat: map[int64]uuid.UUID{}, profiles: map[uuid.UUID]domain.TelegramProfile{}}
}

// link adds an existing (email) user bound to chat.
func (m *memLoginUsers) link(chat int64, banned bool) *domain.User {
	u := &domain.User{ID: uuid.New(), Email: "anna@example.com", Role: domain.RoleUser, LearningLanguage: "en", IsBanned: banned}
	m.byID[u.ID], m.chat[chat] = u, u.ID
	return u
}

func (m *memLoginUsers) GetByID(_ context.Context, id uuid.UUID) (*domain.User, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if u, ok := m.byID[id]; ok {
		c := *u
		return &c, nil
	}
	return nil, domain.ErrNotFound
}

func (m *memLoginUsers) GetByTelegramChat(_ context.Context, chat int64) (*domain.User, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if id, ok := m.chat[chat]; ok {
		c := *m.byID[id]
		return &c, nil
	}
	return nil, domain.ErrNotFound
}

func (m *memLoginUsers) FindOrCreateTelegramUser(_ context.Context, u *domain.User, p domain.TelegramProfile) (*domain.User, bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if id, ok := m.chat[p.ChatID]; ok {
		c := *m.byID[id]
		return &c, false, nil
	}
	c := *u
	m.byID[c.ID], m.chat[p.ChatID], m.profiles[c.ID] = &c, c.ID, p
	m.creates++
	return u, true, nil
}

type askedMessage struct {
	chat int64
	text string
	rows [][]domain.InlineButton
}

type editedMessage struct {
	chat, message int64
	text          string
}

type fakeLoginBot struct {
	mu       sync.Mutex
	sent     []sentMessage
	asked    []askedMessage
	edits    []editedMessage
	answered []string
}

func (b *fakeLoginBot) SendMessage(_ context.Context, chat int64, text string, button *domain.TelegramButton) error {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.sent = append(b.sent, sentMessage{chat, text, button})
	return nil
}
func (b *fakeLoginBot) SendMessageButtons(_ context.Context, chat int64, text string, rows [][]domain.InlineButton) error {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.asked = append(b.asked, askedMessage{chat, text, rows})
	return nil
}
func (b *fakeLoginBot) EditMessageText(_ context.Context, chat, message int64, text string) error {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.edits = append(b.edits, editedMessage{chat, message, text})
	return nil
}
func (b *fakeLoginBot) AnswerCallbackQuery(_ context.Context, id string) error {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.answered = append(b.answered, id)
	return nil
}

func (b *fakeLoginBot) lastEdit(t *testing.T) string {
	t.Helper()
	if len(b.edits) == 0 {
		t.Fatal("the question was not edited")
	}
	return b.edits[len(b.edits)-1].text
}

const iPhoneSafari = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1"

type loginFixture struct {
	svc    *TelegramLoginService
	repo   *memLogins
	users  *memLoginUsers
	bot    *fakeLoginBot
	tokens TokenManager
	now    *time.Time
}

func newLoginFixture() loginFixture {
	repo, users, bot := newMemLogins(), newMemLoginUsers(), &fakeLoginBot{}
	tokens := auth.NewTokenManager("secret-secret-secret-secret-1234", "test", time.Minute, time.Hour)
	svc := NewTelegramLoginService(repo, bot, "@yodlafun_bot", users, tokens)
	now := time.Date(2026, 11, 21, 9, 30, 0, 0, time.UTC) // 14:30 in Tashkent
	svc.now = func() time.Time { return now }
	return loginFixture{svc: svc, repo: repo, users: users, bot: bot, tokens: tokens, now: &now}
}

// start creates a login and returns its code (from the deep link) and secret.
func (f loginFixture) start(t *testing.T) (code, secret string) {
	t.Helper()
	st, err := f.svc.Start(context.Background(), iPhoneSafari)
	if err != nil {
		t.Fatal(err)
	}
	code = strings.TrimPrefix(st.URL, "https://t.me/yodlafun_bot?start=")
	if !domain.IsTelegramLoginCode(code) {
		t.Fatalf("url %q", st.URL)
	}
	return code, st.Secret
}

var anna = TelegramFrom{Username: "anna_k", LanguageCode: "ru", FirstName: "Anna", LastName: "Karimova"}

func (f loginFixture) press(t *testing.T, chat int64, data string) {
	t.Helper()
	f.svc.OnCallback(context.Background(), "cb-1", chat, 55, data, anna)
}

func (f loginFixture) poll(t *testing.T, secret string) domain.TelegramLoginPoll {
	t.Helper()
	res, err := f.svc.Poll(context.Background(), secret)
	if err != nil {
		t.Fatal(err)
	}
	return res
}

// --- Start -------------------------------------------------------------------------------------

func TestTelegramLogin_StartStoresOnlyTheHash(t *testing.T) {
	f := newLoginFixture()
	st, err := f.svc.Start(context.Background(), iPhoneSafari)
	if err != nil {
		t.Fatal(err)
	}
	code := strings.TrimPrefix(st.URL, "https://t.me/yodlafun_bot?start=")
	if !strings.HasPrefix(st.URL, "https://t.me/yodlafun_bot?start=login_") || !domain.IsTelegramLoginCode(code) {
		t.Fatalf("url %q", st.URL)
	}
	if !st.ExpiresAt.Equal(f.now.Add(5 * time.Minute)) {
		t.Errorf("expires_at %v, want now + 5 min", st.ExpiresAt)
	}
	row := f.repo.rows[code]
	if row == nil || len(f.repo.rows) != 1 {
		t.Fatalf("rows %v", f.repo.rows)
	}
	raw, _ := base64.RawURLEncoding.DecodeString(st.Secret)
	sum := sha256.Sum256(raw)
	if len(raw) != 32 || !bytes.Equal(row.SecretHash, sum[:]) {
		t.Error("the stored hash is not sha256 of the secret")
	}
	if bytes.Contains(row.SecretHash, []byte(st.Secret)) || bytes.Contains(row.SecretHash, raw) || strings.Contains(code, st.Secret) {
		t.Error("the secret itself is stored or in the link")
	}
	if row.Device != "iPhone · Safari" || row.Status != domain.LoginPending || row.ChatID != nil || row.UserID != nil {
		t.Errorf("row %+v", row)
	}
	// Every login has its own code and secret.
	st2, _ := f.svc.Start(context.Background(), iPhoneSafari)
	if st2.URL == st.URL || st2.Secret == st.Secret {
		t.Error("a second login reuses the code or the secret")
	}
}

func TestTelegramLogin_StartDeletesExpiredLogins(t *testing.T) {
	f := newLoginFixture()
	old, _ := f.start(t)
	*f.now = f.now.Add(5*time.Minute + time.Second)
	f.start(t)
	if _, ok := f.repo.rows[old]; ok || len(f.repo.rows) != 1 {
		t.Errorf("the expired login is still there (%d rows)", len(f.repo.rows))
	}
}

func TestTelegramLogin_UnavailableWithoutABot(t *testing.T) {
	for name, svc := range map[string]*TelegramLoginService{
		"no token":    NewTelegramLoginService(newMemLogins(), nil, "yodlafun_bot", newMemLoginUsers(), nil),
		"no username": NewTelegramLoginService(newMemLogins(), &fakeLoginBot{}, "", newMemLoginUsers(), nil),
	} {
		if _, err := svc.Start(context.Background(), ""); !errors.Is(err, domain.ErrTelegramUnavailable) {
			t.Errorf("%s: start err = %v", name, err)
		}
		if _, err := svc.Poll(context.Background(), "x"); !errors.Is(err, domain.ErrTelegramUnavailable) {
			t.Errorf("%s: poll err = %v", name, err)
		}
	}
}

// --- OnStart -----------------------------------------------------------------------------------

func TestTelegramLogin_OnStartAsksOnce(t *testing.T) {
	f := newLoginFixture()
	code, secret := f.start(t)
	f.svc.OnStart(context.Background(), 777, code, anna)
	if len(f.bot.asked) != 1 || len(f.bot.sent) != 0 {
		t.Fatalf("asked %d, sent %d", len(f.bot.asked), len(f.bot.sent))
	}
	q := f.bot.asked[0]
	want := "Вход в yodla\n\nУстройство: iPhone · Safari\nВремя: 14:30\n\nЕсли входишь не ты — нажми «Нет». Никому не пересылай эту ссылку."
	if q.chat != 777 || q.text != want {
		t.Errorf("question to %d:\n%q\nwant\n%q", q.chat, q.text, want)
	}
	if len(q.rows) != 1 || len(q.rows[0]) != 2 ||
		q.rows[0][0] != (domain.InlineButton{Text: "✅ Да, это я", CallbackData: "lg:y:" + code}) ||
		q.rows[0][1] != (domain.InlineButton{Text: "Нет", CallbackData: "lg:n:" + code}) {
		t.Errorf("buttons %+v", q.rows)
	}
	for _, b := range q.rows[0] {
		if len(b.CallbackData) > 64 {
			t.Errorf("callback data %q is over Telegram's 64 bytes", b.CallbackData)
		}
	}
	if row := f.repo.rows[code]; row.Status != domain.LoginAsked || *row.ChatID != 777 {
		t.Errorf("row %+v", row)
	}
	// Start again in the same chat: the question is right above, nothing new.
	f.svc.OnStart(context.Background(), 777, code, anna)
	if len(f.bot.asked) != 1 || len(f.bot.sent) != 0 {
		t.Errorf("asked %d, sent %d after a second Start", len(f.bot.asked), len(f.bot.sent))
	}
	// The link pressed in another chat: never asked there, the asked chat stays.
	f.svc.OnStart(context.Background(), 999, code, TelegramFrom{LanguageCode: "en"})
	if len(f.bot.asked) != 1 || len(f.bot.sent) != 1 || f.bot.sent[0].chat != 999 ||
		f.bot.sent[0].text != "This link has expired. Press “Continue with Telegram” again." {
		t.Errorf("asked %d, sent %+v", len(f.bot.asked), f.bot.sent)
	}
	if *f.repo.rows[code].ChatID != 777 {
		t.Error("another chat took the login over")
	}
	// Asking alone never signs in.
	if res := f.poll(t, secret); res.Status != domain.PollPending || res.Tokens.AccessToken != "" {
		t.Errorf("poll after /start = %+v", res)
	}
}

func TestTelegramLogin_OnStartIgnoresExpiredAndMalformedCodes(t *testing.T) {
	f := newLoginFixture()
	code, _ := f.start(t)
	*f.now = f.now.Add(5 * time.Minute)
	f.svc.OnStart(context.Background(), 777, code, anna)
	f.svc.OnStart(context.Background(), 777, "login_short", anna)
	f.svc.OnStart(context.Background(), 777, "login_"+strings.Repeat("Z", 32), anna) // well-formed, unknown
	if len(f.bot.asked) != 0 || len(f.bot.sent) != 3 {
		t.Fatalf("asked %d, sent %d", len(f.bot.asked), len(f.bot.sent))
	}
	for _, m := range f.bot.sent {
		if m.text != "Ссылка устарела. Нажмите «Войти через Telegram» ещё раз." {
			t.Errorf("reply %q", m.text)
		}
	}
	if f.repo.rows[code].Status != domain.LoginPending {
		t.Error("an expired login was asked")
	}
}

func TestTelegramLogin_QuestionLanguages(t *testing.T) {
	for lang, want := range map[string][3]string{
		"en-US": {"Sign in to yodla\n\nDevice: Windows · browser\nTime: 14:30\n\n", "✅ Yes, it’s me", "No"},
		"uz":    {"yodla’ga kirish\n\nQurilma: Windows · brauzer\nVaqt: 14:30\n\n", "✅ Ha, bu men", "Yo‘q"},
		"ru":    {"Вход в yodla\n\nУстройство: Windows · браузер\n", "✅ Да, это я", "Нет"},
	} {
		f := newLoginFixture()
		st, _ := f.svc.Start(context.Background(), "Mozilla/5.0 (Windows NT 10.0) Unknown/1.0")
		f.svc.OnStart(context.Background(), 777, strings.TrimPrefix(st.URL, "https://t.me/yodlafun_bot?start="), TelegramFrom{LanguageCode: lang})
		q := f.bot.asked[0]
		if !strings.HasPrefix(q.text, want[0]) || q.rows[0][0].Text != want[1] || q.rows[0][1].Text != want[2] {
			t.Errorf("%s: %q %+v", lang, q.text, q.rows)
		}
	}
}

// --- OnCallback --------------------------------------------------------------------------------

func TestTelegramLogin_CallbackFromAnotherChatIsRejected(t *testing.T) {
	f := newLoginFixture()
	code, secret := f.start(t)
	f.svc.OnStart(context.Background(), 777, code, anna)
	f.press(t, 999, "lg:y:"+code)
	if len(f.bot.answered) != 1 || f.bot.edits[0].chat != 999 || f.bot.lastEdit(t) != "Ссылка устарела. Нажмите «Войти через Telegram» ещё раз." {
		t.Errorf("answered %v, edits %+v", f.bot.answered, f.bot.edits)
	}
	if row := f.repo.rows[code]; row.Status != domain.LoginAsked || row.UserID != nil || f.users.creates != 0 {
		t.Errorf("row %+v, users created %d", row, f.users.creates)
	}
	if res := f.poll(t, secret); res.Status != domain.PollPending {
		t.Errorf("poll = %+v", res)
	}
}

func TestTelegramLogin_YesCreatesAUserOnceForAnUnknownChat(t *testing.T) {
	f := newLoginFixture()
	code, secret := f.start(t)
	f.svc.OnStart(context.Background(), 777, code, anna)
	f.press(t, 777, "lg:y:"+code)
	if f.bot.answered[0] != "cb-1" || f.bot.edits[0] != (editedMessage{777, 55, "✅ Вход подтверждён. Вернитесь в браузер."}) {
		t.Errorf("answered %v, edits %+v", f.bot.answered, f.bot.edits)
	}
	if f.users.creates != 1 {
		t.Fatalf("%d users created", f.users.creates)
	}
	id := f.users.chat[777]
	u, p := f.users.byID[id], f.users.profiles[id]
	if u.Email != "tg777@telegram.yodla.fun" || !u.NeedsLanguage || u.LearningLanguage != domain.DefaultLearningLang || u.Role != domain.RoleUser {
		t.Errorf("user %+v", u)
	}
	if !strings.HasPrefix(u.PasswordHash, "$2") || bcrypt.CompareHashAndPassword([]byte(u.PasswordHash), []byte("")) == nil {
		t.Errorf("password hash %q: want bcrypt of a random password", u.PasswordHash)
	}
	if *p.FullName != "Anna Karimova" || *p.Username != "anna_k" || p.Lang != "ru" || p.ChatID != 777 {
		t.Errorf("profile %+v", p)
	}
	res := f.poll(t, secret)
	if res.Status != domain.PollOK || !res.NewUser {
		t.Fatalf("poll = %+v", res)
	}
	if got, err := f.tokens.Parse(res.Tokens.AccessToken, auth.TypeAccess); err != nil || got != id {
		t.Errorf("access token for %v (err %v), want %v", got, err, id)
	}
	if got, err := f.tokens.Parse(res.Tokens.RefreshToken, auth.TypeRefresh); err != nil || got != id {
		t.Errorf("refresh token for %v (err %v), want %v", got, err, id)
	}

	// The same chat signs in again: the same account, no second one, and not "new".
	code2, secret2 := f.start(t)
	f.svc.OnStart(context.Background(), 777, code2, anna)
	f.press(t, 777, "lg:y:"+code2)
	res = f.poll(t, secret2)
	if f.users.creates != 1 || res.Status != domain.PollOK || res.NewUser {
		t.Fatalf("second sign-in: %d users, poll %+v", f.users.creates, res)
	}
	if got, _ := f.tokens.Parse(res.Tokens.AccessToken, auth.TypeAccess); got != id {
		t.Errorf("second sign-in is user %v, want %v", got, id)
	}
}

func TestTelegramLogin_YesReusesTheLinkedUser(t *testing.T) {
	f := newLoginFixture()
	linked := f.users.link(777, false)
	code, secret := f.start(t)
	f.svc.OnStart(context.Background(), 777, code, anna)
	f.press(t, 777, "lg:y:"+code)
	res := f.poll(t, secret)
	if res.Status != domain.PollOK || res.NewUser || f.users.creates != 0 {
		t.Fatalf("poll %+v, users created %d", res, f.users.creates)
	}
	if got, _ := f.tokens.Parse(res.Tokens.AccessToken, auth.TypeAccess); got != linked.ID {
		t.Errorf("signed in as %v, want the linked %v", got, linked.ID)
	}
	if row := f.repo.rows[code]; row.Status != domain.LoginUsed || *row.UserID != linked.ID {
		t.Errorf("row %+v", row)
	}
}

func TestTelegramLogin_BannedUserIsRefused(t *testing.T) {
	f := newLoginFixture()
	f.users.link(777, true)
	code, secret := f.start(t)
	f.svc.OnStart(context.Background(), 777, code, anna)
	f.press(t, 777, "lg:y:"+code)
	if f.bot.lastEdit(t) != "Этот аккаунт заблокирован." {
		t.Errorf("edit %q", f.bot.lastEdit(t))
	}
	if row := f.repo.rows[code]; row.Status != domain.LoginDenied || row.UserID != nil {
		t.Errorf("row %+v", row)
	}
	if res := f.poll(t, secret); res.Status != domain.PollDenied || res.Tokens.AccessToken != "" {
		t.Errorf("poll = %+v", res)
	}
}

func TestTelegramLogin_BannedAfterTheYesGetsNoSession(t *testing.T) {
	f := newLoginFixture()
	u := f.users.link(777, false)
	code, secret := f.start(t)
	f.svc.OnStart(context.Background(), 777, code, anna)
	f.press(t, 777, "lg:y:"+code)
	f.users.byID[u.ID].IsBanned = true
	if res := f.poll(t, secret); res.Status != domain.PollDenied || res.Tokens.AccessToken != "" {
		t.Errorf("poll = %+v", res)
	}
}

func TestTelegramLogin_NoDenies(t *testing.T) {
	f := newLoginFixture()
	code, secret := f.start(t)
	f.svc.OnStart(context.Background(), 777, code, TelegramFrom{LanguageCode: "uz"})
	f.svc.OnCallback(context.Background(), "cb-1", 777, 55, "lg:n:"+code, TelegramFrom{LanguageCode: "uz"})
	if f.bot.lastEdit(t) != "Kirish bekor qilindi." {
		t.Errorf("edit %q", f.bot.lastEdit(t))
	}
	if res := f.poll(t, secret); res.Status != domain.PollDenied {
		t.Errorf("poll = %+v", res)
	}
	// "Yes" pressed after "no" (it was on its way): still declined, nobody signed in.
	f.press(t, 777, "lg:y:"+code)
	if f.bot.lastEdit(t) != "Вход отменён." || f.users.creates != 0 || f.repo.rows[code].Status != domain.LoginDenied {
		t.Errorf("edit %q, users %d, status %s", f.bot.lastEdit(t), f.users.creates, f.repo.rows[code].Status)
	}
}

func TestTelegramLogin_SecondYesSaysDoneAgain(t *testing.T) {
	f := newLoginFixture()
	code, _ := f.start(t)
	f.svc.OnStart(context.Background(), 777, code, anna)
	f.press(t, 777, "lg:y:"+code)
	f.press(t, 777, "lg:y:"+code)
	if len(f.bot.edits) != 2 || f.bot.edits[1].text != "✅ Вход подтверждён. Вернитесь в браузер." || f.users.creates != 1 {
		t.Errorf("edits %+v, users %d", f.bot.edits, f.users.creates)
	}
}

func TestTelegramLogin_CallbackAfterExpiryOrMalformed(t *testing.T) {
	f := newLoginFixture()
	code, secret := f.start(t)
	f.svc.OnStart(context.Background(), 777, code, anna)
	*f.now = f.now.Add(5 * time.Minute)
	f.press(t, 777, "lg:y:"+code)
	f.press(t, 777, "lg:x:"+code)
	f.press(t, 777, "lg:y:login_nope")
	if len(f.bot.answered) != 3 || len(f.bot.edits) != 3 {
		t.Fatalf("answered %d, edits %d", len(f.bot.answered), len(f.bot.edits))
	}
	for _, e := range f.bot.edits {
		if e.text != "Ссылка устарела. Нажмите «Войти через Telegram» ещё раз." {
			t.Errorf("edit %q", e.text)
		}
	}
	if f.users.creates != 0 || f.repo.rows[code].Status != domain.LoginAsked {
		t.Errorf("users %d, status %s", f.users.creates, f.repo.rows[code].Status)
	}
	if res := f.poll(t, secret); res.Status != domain.PollExpired {
		t.Errorf("poll = %+v", res)
	}
}

// --- Poll --------------------------------------------------------------------------------------

func TestTelegramLogin_PollReturnsTokensOnceThenExpired(t *testing.T) {
	f := newLoginFixture()
	code, secret := f.start(t)
	if res := f.poll(t, secret); res.Status != domain.PollPending {
		t.Errorf("before /start: %+v", res)
	}
	f.svc.OnStart(context.Background(), 777, code, anna)
	f.press(t, 777, "lg:y:"+code)
	if res := f.poll(t, secret); res.Status != domain.PollOK || res.Tokens.AccessToken == "" || res.Tokens.RefreshToken == "" {
		t.Fatalf("first poll = %+v", res)
	}
	if res := f.poll(t, secret); res.Status != domain.PollExpired || res.Tokens.AccessToken != "" {
		t.Errorf("second poll = %+v", res)
	}
}

func TestTelegramLogin_PollUnknownOrExpired(t *testing.T) {
	f := newLoginFixture()
	code, secret := f.start(t)
	other, _, _ := domain.NewTelegramLoginSecret(nil)
	for _, s := range []string{"", "garbage", other, code} {
		if res := f.poll(t, s); res.Status != domain.PollExpired {
			t.Errorf("poll(%q) = %+v", s, res)
		}
	}
	// Confirmed, but collected after its 5 minutes: no session.
	f.svc.OnStart(context.Background(), 777, code, anna)
	f.press(t, 777, "lg:y:"+code)
	*f.now = f.now.Add(5 * time.Minute)
	if res := f.poll(t, secret); res.Status != domain.PollExpired || res.Tokens.AccessToken != "" {
		t.Errorf("poll after expiry = %+v", res)
	}
}

// --- the webhook: TelegramService hands the sign-in updates over --------------------------------

func callbackUpdate(t *testing.T, chat int64, data string) TelegramUpdate {
	t.Helper()
	raw, _ := json.Marshal(map[string]any{"update_id": 2, "callback_query": map[string]any{
		"id": "cb-9", "data": data, "from": map[string]any{"id": chat, "username": "anna_k", "first_name": "Anna", "last_name": "Karimova", "language_code": "en"},
		"message": map[string]any{"message_id": 31, "chat": map[string]any{"id": chat, "type": "private"}},
	}})
	var u TelegramUpdate
	if err := json.Unmarshal(raw, &u); err != nil {
		t.Fatal(err)
	}
	return u
}

func TestTelegram_SignInUpdatesGoToTheLoginService(t *testing.T) {
	svc, _, bot, _ := newTelegramFixture()
	f := newLoginFixture()
	svc.WithLogin(f.svc)
	ctx := context.Background()
	code, secret := f.start(t)

	u := update(t, "private", "/start "+code, "anna_k", "en")
	u.Message.From.FirstName, u.Message.From.LastName = "Anna", "Karimova"
	svc.HandleUpdate(ctx, u)
	if len(f.bot.asked) != 1 || f.bot.asked[0].chat != 777 || len(bot.sent) != 0 {
		t.Fatalf("asked %+v, link bot sent %+v", f.bot.asked, bot.sent)
	}
	// Not in a private chat: ignored.
	svc.HandleUpdate(ctx, update(t, "group", "/start "+code, "anna_k", "en"))
	if len(f.bot.asked) != 1 || len(f.bot.sent) != 0 {
		t.Error("a group /start reached the sign-in")
	}
	// Buttons that are not the sign-in's are ignored.
	svc.HandleUpdate(ctx, callbackUpdate(t, 777, "other:y"))
	if len(f.bot.answered) != 0 {
		t.Error("a foreign button reached the sign-in")
	}
	svc.HandleUpdate(ctx, callbackUpdate(t, 777, "lg:y:"+code))
	if len(f.bot.answered) != 1 || f.bot.answered[0] != "cb-9" || f.bot.edits[0] != (editedMessage{777, 31, "✅ Signed in. Go back to your browser."}) {
		t.Fatalf("answered %v, edits %+v", f.bot.answered, f.bot.edits)
	}
	if p := f.users.profiles[f.users.chat[777]]; *p.FullName != "Anna Karimova" || *p.Username != "anna_k" {
		t.Errorf("profile from the button press: %+v", p)
	}
	if res := f.poll(t, secret); res.Status != domain.PollOK || !res.NewUser {
		t.Errorf("poll = %+v", res)
	}
}

func TestTelegram_ExistingFlowsUnchangedWithSignInOn(t *testing.T) {
	svc, repo, bot, _ := newTelegramFixture()
	f := newLoginFixture()
	svc.WithLogin(f.svc)
	ctx := context.Background()
	user := uuid.New()
	link, _ := svc.CreateLink(ctx, user)
	svc.HandleUpdate(ctx, update(t, "private", "/start "+link.Code, "anna", "ru"))
	if repo.chat[user] != 777 || len(bot.sent) != 1 || !strings.HasPrefix(bot.sent[0].text, "Готово") {
		t.Fatalf("link-code binding: chat %d, sent %+v", repo.chat[user], bot.sent)
	}
	svc.HandleUpdate(ctx, update(t, "private", "/start", "anna", "en"))
	svc.HandleUpdate(ctx, update(t, "private", "/stop", "anna", "en"))
	svc.HandleUpdate(ctx, update(t, "private", "/resume", "anna", "en"))
	svc.HandleUpdate(ctx, update(t, "private", "/start YL-ZZZZZZ", "anna", "en"))
	want := []string{"To connect", "Notifications are off", "Notifications are on", "This code has expired"}
	if len(bot.sent) != 1+len(want) {
		t.Fatalf("sent %+v", bot.sent)
	}
	for i, w := range want {
		if !strings.HasPrefix(bot.sent[i+1].text, w) {
			t.Errorf("reply %d: %q, want %q…", i, bot.sent[i+1].text, w)
		}
	}
	if len(f.bot.asked)+len(f.bot.sent)+len(f.bot.edits) != 0 {
		t.Error("the sign-in got updates that are not its own")
	}
}

func TestTelegram_SignInStartWithoutTheLoginServiceIsExpired(t *testing.T) {
	svc, _, bot, _ := newTelegramFixture()
	svc.HandleUpdate(context.Background(), update(t, "private", "/start login_"+strings.Repeat("a", 32), "anna", "en"))
	svc.HandleUpdate(context.Background(), callbackUpdate(t, 777, "lg:y:login_"+strings.Repeat("a", 32)))
	if len(bot.sent) != 1 || !strings.Contains(bot.sent[0].text, "expired") {
		t.Errorf("sent %+v", bot.sent)
	}
}

// --- registration and the learning language ----------------------------------------------------

func TestRegister_RefusesTheTelegramEmailDomain(t *testing.T) {
	svc, users := newAuth(nil)
	for _, email := range []string{"tg123@telegram.yodla.fun", " TG5@Telegram.Yodla.Fun"} {
		if _, _, err := svc.Register(context.Background(), email, "password123", "de"); !errors.Is(err, domain.ErrValidation) {
			t.Errorf("%q: err = %v", email, err)
		}
	}
	if len(users.created) != 0 {
		t.Error("an account with the Telegram domain was registered")
	}
}

type memFirstLanguage struct {
	needs map[uuid.UUID]bool
	lang  map[uuid.UUID]string
}

func (m *memFirstLanguage) SetFirstLearningLanguage(_ context.Context, id uuid.UUID, lang string) (bool, error) {
	if !m.needs[id] {
		return false, nil
	}
	m.needs[id], m.lang[id] = false, lang
	return true, nil
}

func TestLearningLanguage_ChosenOnceWithTheStarterFolder(t *testing.T) {
	user := uuid.New()
	store := &memFirstLanguage{needs: map[uuid.UUID]bool{user: true}, lang: map[uuid.UUID]string{}}
	st := &fakeStarter{}
	svc := NewLearningLanguageService(store, st)
	ctx := context.Background()
	if err := svc.Choose(ctx, user, "xx"); !errors.Is(err, domain.ErrValidation) {
		t.Errorf("unknown language: err = %v", err)
	}
	if err := svc.Choose(ctx, user, " KO "); err != nil {
		t.Fatal(err)
	}
	if store.lang[user] != "ko" || store.needs[user] || st.calls != 1 || st.lastUser != user || st.lastLang != "ko" {
		t.Errorf("lang %q needs %v starter %+v", store.lang[user], store.needs[user], st)
	}
	if err := svc.Choose(ctx, user, "fr"); !errors.Is(err, domain.ErrLanguageChosen) {
		t.Errorf("second choice: err = %v", err)
	}
	if store.lang[user] != "ko" || st.calls != 1 {
		t.Errorf("the second choice changed something: %q, starter %d", store.lang[user], st.calls)
	}
	// An account that chose at registration (or does not exist) is never asked.
	if err := svc.Choose(ctx, uuid.New(), "de"); !errors.Is(err, domain.ErrLanguageChosen) {
		t.Errorf("registered account: err = %v", err)
	}
}

func TestLearningLanguage_StarterFailureDoesNotFailTheChoice(t *testing.T) {
	user := uuid.New()
	store := &memFirstLanguage{needs: map[uuid.UUID]bool{user: true}, lang: map[uuid.UUID]string{}}
	if err := NewLearningLanguageService(store, &fakeStarter{panics: true}).Choose(context.Background(), user, "de"); err != nil {
		t.Errorf("err = %v", err)
	}
	if store.lang[user] != "de" {
		t.Error("the language was not saved")
	}
}
