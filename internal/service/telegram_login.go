package service

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"strings"
	"time"

	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"

	"learnwords/internal/domain"
)

// TelegramLoginRepository stores the sign-in attempts (postgres.TelegramLoginRepository).
type TelegramLoginRepository interface {
	// Create deletes the expired logins and stores l (pending). ErrAlreadyExists: the code is taken.
	Create(ctx context.Context, l domain.TelegramLogin, now time.Time) error
	// Get reads a login by its code (found = false when none).
	Get(ctx context.Context, code string) (domain.TelegramLogin, bool, error)
	// Ask: a pending, unexpired login becomes asked in chatID. false = it was not pending or expired.
	Ask(ctx context.Context, code string, chatID int64, now time.Time) (domain.TelegramLogin, bool, error)
	// Decide: the asked, unexpired login of chatID becomes status (confirmed with the user, or
	// denied). false = it is not asked in that chat (any more) or it expired: nothing changes.
	Decide(ctx context.Context, code string, chatID int64, now time.Time, status string, userID *uuid.UUID, newUser bool) (bool, error)
	// Collect: in one statement, the confirmed, unexpired login with this secret becomes used.
	// ok = false when there is none.
	Collect(ctx context.Context, secretHash []byte, now time.Time) (userID uuid.UUID, newUser bool, ok bool, err error)
	// BySecret reads a login by its secret's hash (found = false when none).
	BySecret(ctx context.Context, secretHash []byte) (domain.TelegramLogin, bool, error)
}

// TelegramLoginBot is the part of the Bot API the sign-in uses (provider/telegram.Client).
type TelegramLoginBot interface {
	SendMessage(ctx context.Context, chatID int64, text string, button *domain.TelegramButton) error
	SendMessageButtons(ctx context.Context, chatID int64, text string, rows [][]domain.InlineButton) error
	EditMessageText(ctx context.Context, chatID, messageID int64, text string) error
	AnswerCallbackQuery(ctx context.Context, callbackID string) error
}

// TelegramLoginUsers finds the user of a chat or creates one (postgres.UserRepository).
type TelegramLoginUsers interface {
	GetByID(ctx context.Context, id uuid.UUID) (*domain.User, error)
	// GetByTelegramChat: ErrNotFound when no user is bound to the chat.
	GetByTelegramChat(ctx context.Context, chatID int64) (*domain.User, error)
	// FindOrCreateTelegramUser returns the chat's user, or inserts u (created = true).
	// ErrAlreadyExists when a concurrent call inserted it first.
	FindOrCreateTelegramUser(ctx context.Context, u *domain.User, p domain.TelegramProfile) (*domain.User, bool, error)
}

// The callback data of the two buttons: "lg:y:<code>" (yes) and "lg:n:<code>" (no), at most 43 bytes.
const (
	loginCallbackPrefix = "lg:"
	loginCallbackYes    = "lg:y:"
	loginCallbackNo     = "lg:n:"
)

// TelegramLoginService signs in (and up) with Telegram:
//
//  1. Start: the browser gets a deep link t.me/<bot>?start=<code> and a secret (only its hash is stored).
//  2. OnStart ("/start <code>"): the bot asks that chat "is this you?" with the device and the time.
//  3. OnCallback: only the "yes" button from that chat confirms, for the chat's user — or a new
//     account when the chat has none. A banned user is refused.
//  4. Poll: the browser with the secret collects the session, once.
type TelegramLoginService struct {
	repo        TelegramLoginRepository
	bot         TelegramLoginBot // nil = not configured
	botUsername string
	users       TelegramLoginUsers
	tokens      TokenManager
	now         func() time.Time
	random      io.Reader      // nil = crypto/rand
	loc         *time.Location // the time in the bot's question
}

func NewTelegramLoginService(repo TelegramLoginRepository, bot TelegramLoginBot, botUsername string, users TelegramLoginUsers, tokens TokenManager) *TelegramLoginService {
	loc, err := time.LoadLocation("Asia/Tashkent")
	if err != nil {
		loc = time.FixedZone("Asia/Tashkent", 5*60*60) // UTC+5, no daylight saving
	}
	return &TelegramLoginService{repo: repo, bot: bot, botUsername: strings.TrimPrefix(strings.TrimSpace(botUsername), "@"),
		users: users, tokens: tokens, now: time.Now, loc: loc}
}

// Enabled: a bot token and its username are configured.
func (s *TelegramLoginService) Enabled() bool { return s.bot != nil && s.botUsername != "" }

// Start creates a login for the browser that asks (its User-Agent names the device in the bot's
// question): the deep link, the secret (never stored, only its hash) and when both expire.
func (s *TelegramLoginService) Start(ctx context.Context, userAgent string) (domain.TelegramLoginStart, error) {
	if !s.Enabled() {
		return domain.TelegramLoginStart{}, domain.ErrTelegramUnavailable
	}
	now := s.now()
	expires := now.Add(domain.TelegramLoginTTL).UTC().Truncate(time.Second)
	device := domain.DeviceFromUserAgent(userAgent)
	for attempt := 0; ; attempt++ {
		code, err := domain.NewTelegramLoginCode(s.random)
		if err != nil {
			return domain.TelegramLoginStart{}, err
		}
		secret, hash, err := domain.NewTelegramLoginSecret(s.random)
		if err != nil {
			return domain.TelegramLoginStart{}, err
		}
		err = s.repo.Create(ctx, domain.TelegramLogin{Code: code, SecretHash: hash, Device: device, Status: domain.LoginPending,
			ExpiresAt: expires, CreatedAt: now}, now)
		if errors.Is(err, domain.ErrAlreadyExists) && attempt < 3 {
			continue // 62^32 codes: practically never
		}
		if err != nil {
			return domain.TelegramLoginStart{}, err
		}
		return domain.TelegramLoginStart{URL: "https://t.me/" + s.botUsername + "?start=" + code, Secret: secret, ExpiresAt: expires}, nil
	}
}

// OnStart handles "/start login_…": a pending, unexpired login is asked in this chat — once, so a
// link pressed in another chat later gets "expired". Start pressed again in the asked chat sends
// nothing (the question is right above). Never signs in by itself.
func (s *TelegramLoginService) OnStart(ctx context.Context, chatID int64, code string, from TelegramFrom) {
	lang := from.LanguageCode
	if domain.IsTelegramLoginCode(code) {
		now := s.now()
		l, asked, err := s.repo.Ask(ctx, code, chatID, now)
		if err != nil {
			slog.ErrorContext(ctx, "telegram login: ask failed", "err", err)
			return
		}
		if asked {
			yes, no := loginText(lang, loginYes), loginText(lang, loginNo)
			rows := [][]domain.InlineButton{{{Text: yes, CallbackData: loginCallbackYes + code}, {Text: no, CallbackData: loginCallbackNo + code}}}
			if err := s.bot.SendMessageButtons(ctx, chatID, s.question(lang, l), rows); err != nil {
				slog.WarnContext(ctx, "telegram login: asking failed", "err", err)
			}
			return
		}
		if cur, found, err := s.repo.Get(ctx, code); err == nil && found && cur.Status == domain.LoginAsked &&
			cur.ChatID != nil && *cur.ChatID == chatID && now.Before(cur.ExpiresAt) {
			return
		}
	}
	if err := s.bot.SendMessage(ctx, chatID, loginText(lang, loginExpired), nil); err != nil {
		slog.WarnContext(ctx, "telegram login: reply failed", "err", err)
	}
}

// question is the bot's "Sign in to yodla" with the device and the time the login was created.
func (s *TelegramLoginService) question(lang string, l domain.TelegramLogin) string {
	device := strings.ReplaceAll(l.Device, domain.DeviceUnknownBrowser, loginText(lang, loginBrowser))
	return fmt.Sprintf(loginText(lang, loginQuestion), device, l.CreatedAt.In(s.loc).Format("15:04"))
}

// OnCallback handles a press on "yes" or "no" under the question. Only a login asked in this very
// chat, unexpired, is decided. Yes: the chat's user — or a new account for an unknown chat; a banned
// user is denied. The press is always answered and the question replaced by the outcome (no buttons);
// on an internal error it stays, so the button can be pressed again.
func (s *TelegramLoginService) OnCallback(ctx context.Context, callbackID string, chatID, messageID int64, data string, from TelegramFrom) {
	if err := s.bot.AnswerCallbackQuery(ctx, callbackID); err != nil {
		slog.WarnContext(ctx, "telegram login: answering the button failed", "err", err)
	}
	outcome, err := s.decide(ctx, chatID, data, from)
	if err != nil {
		slog.ErrorContext(ctx, "telegram login: confirming failed", "err", err)
		return
	}
	if err := s.bot.EditMessageText(ctx, chatID, messageID, loginText(from.LanguageCode, outcome)); err != nil {
		slog.WarnContext(ctx, "telegram login: editing the question failed", "err", err)
	}
}

func (s *TelegramLoginService) decide(ctx context.Context, chatID int64, data string, from TelegramFrom) (loginMessage, error) {
	var yes bool
	var code string
	switch {
	case strings.HasPrefix(data, loginCallbackYes):
		yes, code = true, strings.TrimPrefix(data, loginCallbackYes)
	case strings.HasPrefix(data, loginCallbackNo):
		code = strings.TrimPrefix(data, loginCallbackNo)
	}
	if !domain.IsTelegramLoginCode(code) {
		return loginExpired, nil
	}
	now := s.now()
	l, found, err := s.repo.Get(ctx, code)
	if err != nil {
		return 0, err
	}
	if !found || l.Status != domain.LoginAsked || l.ChatID == nil || *l.ChatID != chatID || !now.Before(l.ExpiresAt) {
		return settledOutcome(l, found, chatID), nil
	}
	if !yes {
		return s.finish(ctx, code, chatID, now, domain.LoginDenied, nil, false, loginDeclined)
	}
	u, created, err := s.userFor(ctx, chatID, from, now)
	if err != nil {
		return 0, err
	}
	if u.IsBanned {
		return s.finish(ctx, code, chatID, now, domain.LoginDenied, nil, false, loginBanned)
	}
	return s.finish(ctx, code, chatID, now, domain.LoginConfirmed, &u.ID, created, loginDone)
}

// finish decides the login; when it was decided meanwhile (a second press), the outcome is what it
// was decided as.
func (s *TelegramLoginService) finish(ctx context.Context, code string, chatID int64, now time.Time, status string, userID *uuid.UUID, newUser bool, outcome loginMessage) (loginMessage, error) {
	ok, err := s.repo.Decide(ctx, code, chatID, now, status, userID, newUser)
	if err != nil {
		return 0, err
	}
	if ok {
		return outcome, nil
	}
	l, found, err := s.repo.Get(ctx, code)
	if err != nil {
		return 0, err
	}
	return settledOutcome(l, found, chatID), nil
}

// settledOutcome: a login this chat already decided says so again; anything else has expired.
func settledOutcome(l domain.TelegramLogin, found bool, chatID int64) loginMessage {
	if found && l.ChatID != nil && *l.ChatID == chatID {
		switch l.Status {
		case domain.LoginConfirmed, domain.LoginUsed:
			return loginDone
		case domain.LoginDenied:
			return loginDeclined
		}
	}
	return loginExpired
}

// userFor is the user bound to the chat, or a new account for it (created = true): its email is
// TelegramEmail (not a mailbox), its password random (nobody knows it), its name Telegram's, and
// it chooses the learning language on /welcome. No starter folder yet (it depends on the language).
func (s *TelegramLoginService) userFor(ctx context.Context, chatID int64, from TelegramFrom, now time.Time) (*domain.User, bool, error) {
	u, err := s.users.GetByTelegramChat(ctx, chatID)
	if err == nil {
		return u, false, nil
	}
	if !errors.Is(err, domain.ErrNotFound) {
		return nil, false, err
	}
	src := s.random
	if src == nil {
		src = rand.Reader
	}
	pw := make([]byte, 32)
	if _, err := io.ReadFull(src, pw); err != nil {
		return nil, false, err
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(base64.RawURLEncoding.EncodeToString(pw)), bcrypt.DefaultCost)
	if err != nil {
		return nil, false, err
	}
	at := now.UTC()
	candidate := &domain.User{ID: uuid.New(), Email: domain.TelegramEmail(chatID), PasswordHash: string(hash), Role: domain.RoleUser,
		LearningLanguage: domain.DefaultLearningLang, NeedsLanguage: true, CreatedAt: at, UpdatedAt: at}
	var username *string
	if from.Username != "" {
		name := from.Username
		username = &name
	}
	profile := domain.TelegramProfile{ChatID: chatID, Username: username, FullName: domain.TelegramFullName(from.FirstName, from.LastName),
		Lang: domain.TelegramLang(from.LanguageCode), CreatedAt: at}
	u, created, err := s.users.FindOrCreateTelegramUser(ctx, candidate, profile)
	if errors.Is(err, domain.ErrAlreadyExists) { // a second "yes" created it a moment ago
		u, err = s.users.GetByTelegramChat(ctx, chatID)
		return u, false, err
	}
	return u, created, err
}

// Poll is the browser asking about its login with the secret: pending (keep waiting), denied,
// expired (unknown, timed out or collected already) — or ok with a token pair: a confirmed login is
// collected in one statement, so only the first poll gets the session.
func (s *TelegramLoginService) Poll(ctx context.Context, secret string) (domain.TelegramLoginPoll, error) {
	if !s.Enabled() {
		return domain.TelegramLoginPoll{}, domain.ErrTelegramUnavailable
	}
	hash, ok := domain.TelegramLoginSecretHash(secret)
	if !ok {
		return domain.TelegramLoginPoll{Status: domain.PollExpired}, nil
	}
	now := s.now()
	userID, newUser, collected, err := s.repo.Collect(ctx, hash, now)
	if err != nil {
		return domain.TelegramLoginPoll{}, err
	}
	if collected {
		u, err := s.users.GetByID(ctx, userID)
		if err != nil {
			return domain.TelegramLoginPoll{}, err
		}
		if u.IsBanned { // banned after the "yes"
			return domain.TelegramLoginPoll{Status: domain.PollDenied}, nil
		}
		pair, err := s.tokens.IssuePair(userID)
		if err != nil {
			return domain.TelegramLoginPoll{}, err
		}
		return domain.TelegramLoginPoll{Status: domain.PollOK, Tokens: pair, NewUser: newUser}, nil
	}
	l, found, err := s.repo.BySecret(ctx, hash)
	if err != nil {
		return domain.TelegramLoginPoll{}, err
	}
	switch {
	case !found:
		return domain.TelegramLoginPoll{Status: domain.PollExpired}, nil
	case l.Status == domain.LoginDenied:
		return domain.TelegramLoginPoll{Status: domain.PollDenied}, nil
	case !now.Before(l.ExpiresAt):
		return domain.TelegramLoginPoll{Status: domain.PollExpired}, nil
	case l.Status == domain.LoginPending || l.Status == domain.LoginAsked:
		return domain.TelegramLoginPoll{Status: domain.PollPending}, nil
	}
	return domain.TelegramLoginPoll{Status: domain.PollExpired}, nil // used (or confirmed and collected just now)
}

type loginMessage int

const (
	loginQuestion loginMessage = iota // %s: the device, %s: the time (HH:MM)
	loginYes
	loginNo
	loginDone
	loginDeclined
	loginExpired
	loginBanned
	loginBrowser // the device line's word for an unknown browser
	loginMessageCount
)

var loginTexts = map[string][loginMessageCount]string{
	"ru": {
		"Вход в yodla\n\nУстройство: %s\nВремя: %s\n\nЕсли входишь не ты — нажми «Нет». Никому не пересылай эту ссылку.",
		"✅ Да, это я",
		"Нет",
		"✅ Вход подтверждён. Вернитесь в браузер.",
		"Вход отменён.",
		"Ссылка устарела. Нажмите «Войти через Telegram» ещё раз.",
		"Этот аккаунт заблокирован.",
		"браузер",
	},
	"uz": {
		"yodla’ga kirish\n\nQurilma: %s\nVaqt: %s\n\nAgar bu siz bo‘lmasangiz, «Yo‘q» tugmasini bosing. Bu havolani hech kimga yubormang.",
		"✅ Ha, bu men",
		"Yo‘q",
		"✅ Kirish tasdiqlandi. Brauzerga qayting.",
		"Kirish bekor qilindi.",
		"Havola eskirgan. «Telegram orqali kirish» tugmasini yana bosing.",
		"Bu akkaunt bloklangan.",
		"brauzer",
	},
	"en": {
		"Sign in to yodla\n\nDevice: %s\nTime: %s\n\nIf this isn’t you, tap “No”. Never forward this link.",
		"✅ Yes, it’s me",
		"No",
		"✅ Signed in. Go back to your browser.",
		"Sign-in declined.",
		"This link has expired. Press “Continue with Telegram” again.",
		"This account is blocked.",
		"browser",
	},
}

// loginText picks a sign-in text by Telegram's language_code, like botText.
func loginText(languageCode string, m loginMessage) string {
	return loginTexts[botLang(languageCode)][m]
}
