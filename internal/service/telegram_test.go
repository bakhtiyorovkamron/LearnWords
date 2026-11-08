package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	"learnwords/internal/domain"
)

// --- fakes: the same rules as the postgres repository, in memory ----------------------------

type memLinkCode struct {
	user    uuid.UUID
	expires time.Time
	used    *time.Time
}

type memTelegram struct {
	mu    sync.Mutex
	codes map[string]*memLinkCode
	chat  map[uuid.UUID]int64
	name  map[uuid.UUID]*string
	binds int
	taken map[string]bool // codes another user already has (→ ErrAlreadyExists)
	// the gift: once per chat, once per user
	bonusChat map[int64]bool
	bonusUser map[uuid.UUID]int
	usedErr   error // UsedCodeChat fails with it
}

func newMemTelegram() *memTelegram {
	return &memTelegram{codes: map[string]*memLinkCode{}, chat: map[uuid.UUID]int64{}, name: map[uuid.UUID]*string{}, taken: map[string]bool{},
		bonusChat: map[int64]bool{}, bonusUser: map[uuid.UUID]int{}}
}

func (m *memTelegram) ReplaceLinkCode(_ context.Context, user uuid.UUID, code string, expires time.Time) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.taken[code] {
		return domain.ErrAlreadyExists
	}
	for c, v := range m.codes {
		if v.user == user {
			delete(m.codes, c)
		}
	}
	m.codes[code] = &memLinkCode{user: user, expires: expires}
	return nil
}

func (m *memTelegram) BindTelegram(_ context.Context, code string, chatID int64, username *string, now time.Time, bonus int) (bool, int, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	c, ok := m.codes[code]
	if !ok || !domain.LinkCodeActive(c.expires, c.used, now) {
		return false, 0, nil
	}
	c.used = &now
	for u, ch := range m.chat {
		if ch == chatID && u != c.user {
			delete(m.chat, u)
			delete(m.name, u)
		}
	}
	m.chat[c.user], m.name[c.user] = chatID, username
	m.binds++
	if bonus <= 0 || m.bonusChat[chatID] || m.bonusUser[c.user] > 0 {
		return true, 0, nil
	}
	m.bonusChat[chatID], m.bonusUser[c.user] = true, bonus
	return true, bonus, nil
}

func (m *memTelegram) UsedCodeChat(_ context.Context, code string) (int64, bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.usedErr != nil {
		return 0, false, m.usedErr
	}
	c, ok := m.codes[code]
	if !ok || c.used == nil {
		return 0, false, nil
	}
	chat, ok := m.chat[c.user]
	return chat, ok, nil
}

type sentMessage struct {
	chat int64
	text string
}

type fakeBot struct {
	mu   sync.Mutex
	sent []sentMessage
	hook [2]string
}

func (b *fakeBot) SendMessage(_ context.Context, chat int64, text string) error {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.sent = append(b.sent, sentMessage{chat, text})
	return nil
}
func (b *fakeBot) SetWebhook(_ context.Context, url, secret string) error {
	b.hook = [2]string{url, secret}
	return nil
}

func newTelegramFixture() (*TelegramService, *memTelegram, *fakeBot, *time.Time) {
	repo, bot := newMemTelegram(), &fakeBot{}
	svc := NewTelegramService(repo, bot, "@yodla_bot")
	now := time.Date(2026, 11, 8, 12, 0, 0, 0, time.UTC)
	svc.now = func() time.Time { return now }
	return svc, repo, bot, &now
}

// update builds a Bot API update the way Telegram sends it.
func update(t *testing.T, chatType, text, username, lang string) TelegramUpdate {
	t.Helper()
	from := map[string]any{"id": 777, "language_code": lang}
	if username != "" {
		from["username"] = username
	}
	raw, _ := json.Marshal(map[string]any{"update_id": 1, "message": map[string]any{
		"message_id": 1, "text": text, "chat": map[string]any{"id": 777, "type": chatType}, "from": from,
	}})
	var u TelegramUpdate
	if err := json.Unmarshal(raw, &u); err != nil {
		t.Fatal(err)
	}
	return u
}

// --- tests -----------------------------------------------------------------------------------

func TestTelegram_CreateLink(t *testing.T) {
	svc, repo, _, now := newTelegramFixture()
	user := uuid.New()
	link, err := svc.CreateLink(context.Background(), user)
	if err != nil {
		t.Fatal(err)
	}
	if !domain.IsLinkCode(link.Code) || link.URL != "https://t.me/yodla_bot?start="+link.Code {
		t.Errorf("link = %+v", link)
	}
	if !link.ExpiresAt.Equal(now.Add(10 * time.Minute)) {
		t.Errorf("expires_at = %v, want now + 10 min", link.ExpiresAt)
	}
	if len(repo.codes) != 1 {
		t.Errorf("%d codes stored", len(repo.codes))
	}
}

func TestTelegram_OneActiveCodePerUser(t *testing.T) {
	svc, repo, _, _ := newTelegramFixture()
	ctx := context.Background()
	user, other := uuid.New(), uuid.New()
	first, _ := svc.CreateLink(ctx, user)
	otherLink, _ := svc.CreateLink(ctx, other)
	second, _ := svc.CreateLink(ctx, user)
	if first.Code == second.Code {
		t.Fatal("a new link must have a new code")
	}
	if _, ok := repo.codes[first.Code]; ok {
		t.Error("the older code must be deleted")
	}
	if _, ok := repo.codes[otherLink.Code]; !ok {
		t.Error("another user's code must stay")
	}
	// The old link no longer works; the new one does.
	svc.HandleUpdate(ctx, update(t, "private", "/start "+first.Code, "anna", "ru"))
	if _, ok := repo.chat[user]; ok {
		t.Error("the replaced code bound the account")
	}
	svc.HandleUpdate(ctx, update(t, "private", "/start "+second.Code, "anna", "ru"))
	if repo.chat[user] != 777 {
		t.Error("the new code did not bind")
	}
}

func TestTelegram_CreateLinkRetriesATakenCode(t *testing.T) {
	svc, repo, _, _ := newTelegramFixture()
	// The first random code is "YL-AAAAAA" (all zero bytes) and is taken; the next draw is used.
	svc.random = strings.NewReader(strings.Repeat("\x00", 6) + strings.Repeat("\x01", 6))
	repo.taken["YL-AAAAAA"] = true
	link, err := svc.CreateLink(context.Background(), uuid.New())
	if err != nil || link.Code != "YL-BBBBBB" {
		t.Errorf("link = %+v, err = %v", link, err)
	}
}

func TestTelegram_Unavailable(t *testing.T) {
	for name, svc := range map[string]*TelegramService{
		"no token":    NewTelegramService(newMemTelegram(), nil, "yodla_bot"),
		"no username": NewTelegramService(newMemTelegram(), &fakeBot{}, ""),
	} {
		if _, err := svc.CreateLink(context.Background(), uuid.New()); !errors.Is(err, domain.ErrTelegramUnavailable) {
			t.Errorf("%s: err = %v", name, err)
		}
	}
}

func TestTelegram_BindStoresChatAndUsername(t *testing.T) {
	svc, repo, bot, _ := newTelegramFixture()
	ctx := context.Background()
	user := uuid.New()
	link, _ := svc.CreateLink(ctx, user)
	svc.HandleUpdate(ctx, update(t, "private", "/start "+link.Code, "anna_k", "ru"))
	if repo.chat[user] != 777 || repo.name[user] == nil || *repo.name[user] != "anna_k" {
		t.Errorf("chat=%d name=%v", repo.chat[user], repo.name[user])
	}
	if len(bot.sent) != 1 || bot.sent[0].chat != 777 || !strings.HasPrefix(bot.sent[0].text, "Готово") {
		t.Errorf("sent = %+v", bot.sent)
	}
}

func TestTelegram_FirstBindGivesTheGift_OncePerTelegramAndPerUser(t *testing.T) {
	svc, repo, bot, _ := newTelegramFixture()
	ctx := context.Background()
	user, other := uuid.New(), uuid.New()
	link, _ := svc.CreateLink(ctx, user)
	svc.HandleUpdate(ctx, update(t, "private", "/start "+link.Code, "anna_k", "ru"))
	if repo.bonusUser[user] != domain.TelegramBonusCredits {
		t.Fatalf("gift = %d, want %d", repo.bonusUser[user], domain.TelegramBonusCredits)
	}
	if want := "Готово! Telegram подключён к вашему аккаунту yodla. В подарок: +2 фото для добавления слов."; bot.sent[0].text != want {
		t.Errorf("reply %q, want %q", bot.sent[0].text, want)
	}
	// The same Telegram on another account: bound, but no second gift and a plain "done".
	link2, _ := svc.CreateLink(ctx, other)
	svc.HandleUpdate(ctx, update(t, "private", "/start "+link2.Code, "anna_k", "en"))
	if repo.chat[other] != 777 || repo.bonusUser[other] != 0 {
		t.Errorf("chat=%d gift=%d", repo.chat[other], repo.bonusUser[other])
	}
	if bot.sent[1].text != "Done! Telegram is now connected to your yodla account." {
		t.Errorf("second reply %q", bot.sent[1].text)
	}
}

func TestTelegram_GiftReplyInEveryLanguage(t *testing.T) {
	for lang, want := range map[string]string{
		"ru": "+2 фото",
		"uz": "Sovg‘a: so‘z qo‘shish uchun +2 ta surat.",
		"en": "Your gift: +2 photos",
		"de": "Your gift: +2 photos",
	} {
		if got := fmt.Sprintf(botText(lang, botLinkedBonus), 2); !strings.Contains(got, want) {
			t.Errorf("%s: %q, want it to contain %q", lang, got, want)
		}
	}
}

func TestTelegram_NoUsernameIsStoredAsNil(t *testing.T) {
	svc, repo, _, _ := newTelegramFixture()
	ctx := context.Background()
	user := uuid.New()
	link, _ := svc.CreateLink(ctx, user)
	svc.HandleUpdate(ctx, update(t, "private", "/start "+link.Code, "", "en"))
	if repo.chat[user] != 777 || repo.name[user] != nil {
		t.Errorf("chat=%d name=%v, want nil (not \"\")", repo.chat[user], repo.name[user])
	}
}

func TestTelegram_BindIsIdempotent(t *testing.T) {
	svc, repo, bot, _ := newTelegramFixture()
	ctx := context.Background()
	user := uuid.New()
	link, _ := svc.CreateLink(ctx, user)
	svc.HandleUpdate(ctx, update(t, "private", "/start "+link.Code, "anna", "en"))
	// Someone else (another chat) presses the same link: no second bind, the "expired" reply.
	// (The same chat again gets "already connected", see TestTelegram_StartAgain_….)
	u := update(t, "private", "/start "+link.Code, "mallory", "en")
	u.Message.Chat.ID = 999
	svc.HandleUpdate(ctx, u)
	if repo.binds != 1 || repo.chat[user] != 777 || *repo.name[user] != "anna" {
		t.Errorf("binds=%d chat=%d name=%v", repo.binds, repo.chat[user], *repo.name[user])
	}
	if len(bot.sent) != 2 || !strings.Contains(bot.sent[1].text, "expired") || bot.sent[1].chat != 999 {
		t.Errorf("sent = %+v", bot.sent)
	}
}

func TestTelegram_ExpiredCode(t *testing.T) {
	svc, repo, bot, now := newTelegramFixture()
	ctx := context.Background()
	user := uuid.New()
	link, _ := svc.CreateLink(ctx, user)
	*now = now.Add(10*time.Minute + time.Second)
	svc.HandleUpdate(ctx, update(t, "private", "/start "+link.Code, "anna", "uz"))
	if _, ok := repo.chat[user]; ok {
		t.Error("an expired code bound the account")
	}
	if len(bot.sent) != 1 || !strings.HasPrefix(bot.sent[0].text, "Kod eskirgan") {
		t.Errorf("sent = %+v", bot.sent)
	}
}

func TestTelegram_UnknownOrMalformedCodeRepliesExpired(t *testing.T) {
	svc, repo, bot, _ := newTelegramFixture()
	for _, text := range []string{"/start YL-ZZZZZZ", "/start hello", "/start YL-0O1I00"} {
		svc.HandleUpdate(context.Background(), update(t, "private", text, "anna", "en"))
	}
	if repo.binds != 0 || len(bot.sent) != 3 {
		t.Fatalf("binds=%d sent=%d", repo.binds, len(bot.sent))
	}
	for _, m := range bot.sent {
		if !strings.Contains(m.text, "expired") {
			t.Errorf("reply %q", m.text)
		}
	}
}

func TestTelegram_PlainStartGivesAHint(t *testing.T) {
	svc, _, bot, _ := newTelegramFixture()
	for _, lang := range []string{"ru", "uz", "en-US", "de", ""} {
		svc.HandleUpdate(context.Background(), update(t, "private", "/start", "anna", lang))
	}
	want := []string{"Чтобы подключить", "Telegramni ulash", "To connect", "To connect", "To connect"}
	if len(bot.sent) != len(want) {
		t.Fatalf("sent %d", len(bot.sent))
	}
	for i, w := range want {
		if !strings.HasPrefix(bot.sent[i].text, w) {
			t.Errorf("%d: %q, want %q…", i, bot.sent[i].text, w)
		}
	}
}

func TestTelegram_IgnoresNonPrivateChatsAndOtherMessages(t *testing.T) {
	svc, repo, bot, _ := newTelegramFixture()
	ctx := context.Background()
	user := uuid.New()
	link, _ := svc.CreateLink(ctx, user)
	for _, chatType := range []string{"group", "supergroup", "channel"} {
		svc.HandleUpdate(ctx, update(t, chatType, "/start "+link.Code, "anna", "ru"))
	}
	svc.HandleUpdate(ctx, update(t, "private", "hello", "anna", "ru"))
	svc.HandleUpdate(ctx, TelegramUpdate{}) // an update without a message (an edit, a callback…)
	if repo.binds != 0 || len(bot.sent) != 0 {
		t.Errorf("binds=%d sent=%+v", repo.binds, bot.sent)
	}
	svc.HandleUpdate(ctx, update(t, "private", "/start "+link.Code, "anna", "ru"))
	if repo.binds != 1 {
		t.Error("the code must still work in the private chat")
	}
}

func TestTelegram_RegisterWebhook(t *testing.T) {
	svc, _, bot, _ := newTelegramFixture()
	if err := svc.RegisterWebhook(context.Background(), "", "s"); err != nil || bot.hook[0] != "" {
		t.Error("no url: nothing to register")
	}
	_ = svc.RegisterWebhook(context.Background(), "https://yodla.fun/api/telegram/webhook", "s3cret")
	if bot.hook != [2]string{"https://yodla.fun/api/telegram/webhook", "s3cret"} {
		t.Errorf("hook = %v", bot.hook)
	}
}

// startIn is "/start <code>" sent from the private chat `chat`.
func startIn(t *testing.T, chat int64, code, lang string) TelegramUpdate {
	t.Helper()
	raw, _ := json.Marshal(map[string]any{"update_id": 1, "message": map[string]any{
		"message_id": 1, "text": "/start " + code, "chat": map[string]any{"id": chat, "type": "private"},
		"from": map[string]any{"id": chat, "language_code": lang},
	}})
	var u TelegramUpdate
	if err := json.Unmarshal(raw, &u); err != nil {
		t.Fatal(err)
	}
	return u
}

const (
	expiredRU = "Код устарел или уже использован. Нажмите «Подключить» в профиле ещё раз."
	alreadyRU = "Telegram уже подключён ✅"
)

func TestTelegram_StartAgain_FirstBindsThenAlreadyConnected(t *testing.T) {
	svc, repo, bot, now := newTelegramFixture()
	ctx := context.Background()
	user := uuid.New()
	link, _ := svc.CreateLink(ctx, user)

	svc.HandleUpdate(ctx, startIn(t, 777, link.Code, "ru"))
	if repo.chat[user] != 777 || repo.binds != 1 || !strings.HasPrefix(bot.sent[0].text, "Готово! Telegram подключён") {
		t.Fatalf("first start: chat=%d binds=%d sent=%+v", repo.chat[user], repo.binds, bot.sent)
	}
	if repo.bonusUser[user] != domain.TelegramBonusCredits {
		t.Fatalf("gift = %d", repo.bonusUser[user])
	}

	// The same chat, the same code: already connected, nothing changes, no second gift.
	svc.HandleUpdate(ctx, startIn(t, 777, link.Code, "ru"))
	if len(bot.sent) != 2 || bot.sent[1].chat != 777 || bot.sent[1].text != alreadyRU {
		t.Fatalf("second start: %+v", bot.sent)
	}
	if repo.binds != 1 || repo.bonusUser[user] != domain.TelegramBonusCredits || repo.chat[user] != 777 {
		t.Errorf("binds=%d gift=%d chat=%d: nothing may change", repo.binds, repo.bonusUser[user], repo.chat[user])
	}

	// Pressed again much later (the code has expired meanwhile): still "already connected", by language.
	*now = now.Add(24 * time.Hour)
	for lang, want := range map[string]string{
		"en":    "Telegram is already connected ✅",
		"uz":    "Telegram allaqachon ulangan ✅",
		"ru-RU": alreadyRU,
		"":      "Telegram is already connected ✅",
	} {
		svc.HandleUpdate(ctx, startIn(t, 777, link.Code, lang))
		if got := bot.sent[len(bot.sent)-1].text; got != want {
			t.Errorf("lang %q: %q, want %q", lang, got, want)
		}
	}
	if repo.binds != 1 {
		t.Errorf("binds = %d", repo.binds)
	}
}

func TestTelegram_StartWithExpiredCodeFromUnboundChat_SaysExpired(t *testing.T) {
	svc, repo, bot, now := newTelegramFixture()
	ctx := context.Background()
	user := uuid.New()
	link, _ := svc.CreateLink(ctx, user)
	*now = now.Add(domain.LinkCodeTTL + time.Second)

	svc.HandleUpdate(ctx, startIn(t, 888, link.Code, "ru"))
	if len(bot.sent) != 1 || bot.sent[0].text != expiredRU {
		t.Errorf("sent = %+v", bot.sent)
	}
	if repo.binds != 0 {
		t.Errorf("binds = %d", repo.binds)
	}
}

func TestTelegram_StartWithCodeUsedByAnotherChat_SaysExpired_NoRebind(t *testing.T) {
	svc, repo, bot, _ := newTelegramFixture()
	ctx := context.Background()
	user := uuid.New()
	link, _ := svc.CreateLink(ctx, user)
	svc.HandleUpdate(ctx, startIn(t, 777, link.Code, "ru"))

	svc.HandleUpdate(ctx, startIn(t, 888, link.Code, "ru"))
	if len(bot.sent) != 2 || bot.sent[1].chat != 888 || bot.sent[1].text != expiredRU {
		t.Fatalf("sent = %+v", bot.sent)
	}
	if repo.chat[user] != 777 || repo.binds != 1 || repo.bonusUser[user] != domain.TelegramBonusCredits {
		t.Errorf("chat=%d binds=%d gift=%d: the other chat must change nothing", repo.chat[user], repo.binds, repo.bonusUser[user])
	}
}

func TestTelegram_UnknownCodeSaysExpired_LookupErrorToo(t *testing.T) {
	svc, repo, bot, _ := newTelegramFixture()
	ctx := context.Background()
	svc.HandleUpdate(ctx, startIn(t, 777, "YL-ABC234", "ru")) // well-formed, never issued
	svc.HandleUpdate(ctx, startIn(t, 777, "nonsense", "ru"))  // not even a code
	repo.usedErr = errors.New("db down")
	link, _ := svc.CreateLink(ctx, uuid.New())
	svc.HandleUpdate(ctx, startIn(t, 777, link.Code, "ru")) // binds
	svc.HandleUpdate(ctx, startIn(t, 777, link.Code, "ru")) // already connected, but the lookup fails
	texts := []string{}
	for _, m := range bot.sent {
		texts = append(texts, m.text)
	}
	if len(texts) != 4 || texts[0] != expiredRU || texts[1] != expiredRU || texts[3] != expiredRU {
		t.Errorf("replies %q", texts)
	}
}
