package service

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"strings"
	"time"

	"github.com/google/uuid"

	"learnwords/internal/domain"
)

// TelegramRepository stores the one-time link codes and the bound Telegram account.
type TelegramRepository interface {
	// ReplaceLinkCode deletes the user's other codes and stores this one: one active code per user.
	// ErrAlreadyExists when the code is taken (another user's).
	ReplaceLinkCode(ctx context.Context, userID uuid.UUID, code string, expiresAt time.Time) error
	// BindTelegram uses an active code (unused, expires_at > now) and binds the chat to its user, in
	// one transaction. false = no such active code (unknown, expired or used): nothing changes.
	// A bound chat also gets `bonus` photo credits unless this chat or this user had them before;
	// granted is what was given (0 or bonus).
	BindTelegram(ctx context.Context, code string, chatID int64, username *string, now time.Time, bonus int) (bound bool, granted int, err error)
	// UsedCodeChat reads a code without locking: found = it exists, it was used and its user has a
	// Telegram chat bound now; chatID is that chat.
	UsedCodeChat(ctx context.Context, code string) (chatID int64, found bool, err error)
	// ChatID: the private chat the bot bound to the user (found = false when none).
	// A blocked user (telegram_blocked_at set) has no usable chat: found = false.
	ChatID(ctx context.Context, userID uuid.UUID) (chatID int64, found bool, err error)
	// MarkBlocked: Telegram refused a message to the user with 403 (telegram_blocked_at = now()).
	MarkBlocked(ctx context.Context, userID uuid.UUID) error
	// ClearChatBlocked: the chat wrote to the bot again, so it is not blocked.
	ClearChatBlocked(ctx context.Context, chatID int64) error
	// SetChatLang stores the Telegram language (ru | uz | en) of the user bound to the chat, if any.
	SetChatLang(ctx context.Context, chatID int64, lang string) error
	// SetChatNotifications is /stop and /resume; linked = false when no user is bound to the chat.
	SetChatNotifications(ctx context.Context, chatID int64, enabled bool) (linked bool, err error)
	// SetNotifications is the user's own switch (the profile).
	SetNotifications(ctx context.Context, userID uuid.UUID, enabled bool) error
}

// TelegramBot is the Bot API (provider/telegram).
type TelegramBot interface {
	// SendMessage writes plain text, with an optional link button. A 403 is domain.ErrBotBlocked, a
	// 429 a *domain.RetryAfterError.
	SendMessage(ctx context.Context, chatID int64, text string, button *domain.TelegramButton) error
	SetWebhook(ctx context.Context, url, secret string) error
}

// TelegramFrom is the Telegram user who sent a message or pressed a button.
type TelegramFrom struct {
	Username     string `json:"username"`
	LanguageCode string `json:"language_code"`
	FirstName    string `json:"first_name"`
	LastName     string `json:"last_name"`
}

// TelegramUpdate is the part of a Bot API update the bot reads.
type TelegramUpdate struct {
	Message *struct {
		Text string `json:"text"`
		Chat struct {
			ID   int64  `json:"id"`
			Type string `json:"type"`
		} `json:"chat"`
		From *TelegramFrom `json:"from"`
	} `json:"message"`
	// CallbackQuery: a press on an inline button under one of the bot's messages.
	CallbackQuery *struct {
		ID      string        `json:"id"`
		Data    string        `json:"data"`
		From    *TelegramFrom `json:"from"`
		Message *struct {
			MessageID int64 `json:"message_id"`
			Chat      struct {
				ID int64 `json:"id"`
			} `json:"chat"`
		} `json:"message"`
	} `json:"callback_query"`
}

// TelegramLoginUpdates is the sign-in with Telegram (TelegramLoginService): it gets "/start login_…"
// and the presses on its "lg:" buttons.
type TelegramLoginUpdates interface {
	OnStart(ctx context.Context, chatID int64, code string, from TelegramFrom)
	OnCallback(ctx context.Context, callbackID string, chatID, messageID int64, data string, from TelegramFrom)
}

// TelegramService links a site account to Telegram: the profile asks for a deep link
// (t.me/<bot>?start=<code>), the user presses Start, the webhook binds the chat.
type TelegramService struct {
	repo        TelegramRepository
	bot         TelegramBot // nil = not configured
	botUsername string
	login       TelegramLoginUpdates // nil = no sign-in with Telegram
	now         func() time.Time
	random      io.Reader // nil = crypto/rand
}

func NewTelegramService(repo TelegramRepository, bot TelegramBot, botUsername string) *TelegramService {
	return &TelegramService{repo: repo, bot: bot, botUsername: strings.TrimPrefix(strings.TrimSpace(botUsername), "@"), now: time.Now}
}

// WithLogin hands "/start login_…" and the sign-in buttons to l (the sign-in with Telegram).
func (s *TelegramService) WithLogin(l TelegramLoginUpdates) *TelegramService {
	s.login = l
	return s
}

// Enabled: a bot token and its username are configured.
func (s *TelegramService) Enabled() bool { return s.bot != nil && s.botUsername != "" }

// CreateLink makes a fresh code (the user's older ones are deleted) and its deep link.
func (s *TelegramService) CreateLink(ctx context.Context, userID uuid.UUID) (domain.TelegramLink, error) {
	if !s.Enabled() {
		return domain.TelegramLink{}, domain.ErrTelegramUnavailable
	}
	expires := s.now().Add(domain.LinkCodeTTL).UTC().Truncate(time.Second)
	for attempt := 0; ; attempt++ {
		code, err := domain.NewLinkCode(s.random)
		if err != nil {
			return domain.TelegramLink{}, err
		}
		err = s.repo.ReplaceLinkCode(ctx, userID, code, expires)
		if errors.Is(err, domain.ErrAlreadyExists) && attempt < 3 {
			continue // ~1e9 codes: a collision is rare, a second one in a row practically never
		}
		if err != nil {
			return domain.TelegramLink{}, err
		}
		return domain.TelegramLink{Code: code, URL: "https://t.me/" + s.botUsername + "?start=" + code, ExpiresAt: expires}, nil
	}
}

// NotifyUser writes text to the user's linked Telegram chat. sent = false (no error) when the bot
// is not configured or the user has no chat linked (or blocked the bot). The user's broadcast switch
// (/stop) does not matter here: it covers broadcasts only. A 403 marks the user as blocked.
func (s *TelegramService) NotifyUser(ctx context.Context, userID uuid.UUID, text string) (bool, error) {
	if !s.Enabled() {
		return false, nil
	}
	chat, found, err := s.repo.ChatID(ctx, userID)
	if err != nil || !found {
		return false, err
	}
	if err := s.bot.SendMessage(ctx, chat, text, nil); err != nil {
		if errors.Is(err, domain.ErrBotBlocked) {
			if merr := s.repo.MarkBlocked(ctx, userID); merr != nil {
				slog.WarnContext(ctx, "telegram: marking blocked failed", "err", merr)
			}
		}
		return false, err
	}
	return true, nil
}

// SetNotifications is the user's own switch for broadcasts (the profile).
func (s *TelegramService) SetNotifications(ctx context.Context, userID uuid.UUID, enabled bool) error {
	return s.repo.SetNotifications(ctx, userID, enabled)
}

// RegisterWebhook points the bot at url (no-op when the bot or the url is not configured).
func (s *TelegramService) RegisterWebhook(ctx context.Context, url, secret string) error {
	if !s.Enabled() || url == "" {
		return nil
	}
	return s.bot.SetWebhook(ctx, url, secret)
}

// HandleUpdate reacts to "/start <code>" (bind), "/start login_…" and its buttons (sign in, handed
// to the login service) and a bare "/start" (a hint) in private chats; everything else is ignored.
// It never fails the webhook: Telegram would resend the update.
func (s *TelegramService) HandleUpdate(ctx context.Context, u TelegramUpdate) {
	if !s.Enabled() {
		return
	}
	if q := u.CallbackQuery; q != nil {
		if s.login != nil && q.Message != nil && q.ID != "" && strings.HasPrefix(q.Data, loginCallbackPrefix) {
			var from TelegramFrom
			if q.From != nil {
				from = *q.From
			}
			s.login.OnCallback(ctx, q.ID, q.Message.Chat.ID, q.Message.MessageID, q.Data, from)
		}
		return
	}
	m := u.Message
	if m == nil || m.Chat.Type != "private" {
		return
	}
	lang, username := "", (*string)(nil)
	if m.From != nil {
		lang = m.From.LanguageCode
		if m.From.Username != "" {
			name := m.From.Username
			username = &name
		}
	}
	text := strings.TrimSpace(m.Text)
	cmd := command(text)
	var reply string
	switch {
	case text == "/start":
		s.rememberChat(ctx, m.Chat.ID, lang, true)
		reply = botText(lang, botHint)
	case cmd == "/stop" || cmd == "/resume":
		enabled := cmd == "/resume"
		linked, err := s.repo.SetChatNotifications(ctx, m.Chat.ID, enabled)
		if err != nil {
			slog.ErrorContext(ctx, "telegram: switching notifications failed", "err", err)
			return
		}
		switch {
		case !linked:
			reply = botText(lang, botHint)
		case enabled:
			s.rememberChat(ctx, m.Chat.ID, lang, true)
			reply = botText(lang, botResumed)
		default:
			s.rememberChat(ctx, m.Chat.ID, lang, false)
			reply = botText(lang, botStopped)
		}
	case strings.HasPrefix(text, "/start "+domain.TelegramLoginPrefix) && s.login != nil:
		s.rememberChat(ctx, m.Chat.ID, lang, true) // a chat bound to a user: it can receive messages again
		var from TelegramFrom
		if m.From != nil {
			from = *m.From
		}
		s.login.OnStart(ctx, m.Chat.ID, strings.TrimSpace(strings.TrimPrefix(text, "/start ")), from)
		return
	case strings.HasPrefix(text, "/start "):
		code := strings.TrimSpace(strings.TrimPrefix(text, "/start "))
		bound, granted := false, 0
		if domain.IsLinkCode(code) {
			var err error
			bound, granted, err = s.repo.BindTelegram(ctx, code, m.Chat.ID, username, s.now(), domain.TelegramBonusCredits)
			if err != nil {
				slog.ErrorContext(ctx, "telegram: bind failed", "err", err)
				return
			}
		}
		if bound {
			s.rememberChat(ctx, m.Chat.ID, lang, false) // linking clears "blocked" itself
		} else if s.alreadyBoundHere(ctx, code, m.Chat.ID) {
			s.rememberChat(ctx, m.Chat.ID, lang, true)
		}
		switch {
		case bound && granted > 0:
			reply = fmt.Sprintf(botText(lang, botLinkedBonus), granted)
		case bound:
			reply = botText(lang, botLinked)
		case s.alreadyBoundHere(ctx, code, m.Chat.ID):
			reply = botText(lang, botAlreadyLinked)
		default:
			reply = botText(lang, botExpired)
		}
	default:
		return
	}
	if err := s.bot.SendMessage(ctx, m.Chat.ID, reply, nil); err != nil {
		slog.WarnContext(ctx, "telegram: reply failed", "err", err)
	}
}

// command is the bot command of a message ("/stop@yodla_bot now" → "/stop"), "" for plain text.
func command(text string) string {
	if !strings.HasPrefix(text, "/") {
		return ""
	}
	word := strings.Fields(text)[0]
	if i := strings.IndexByte(word, '@'); i >= 0 {
		word = word[:i]
	}
	return strings.ToLower(word)
}

// rememberChat stores the Telegram language of the user bound to the chat and, with unblock, clears
// "blocked" (the chat wrote to the bot, so it can receive messages). Failures are only logged.
func (s *TelegramService) rememberChat(ctx context.Context, chatID int64, languageCode string, unblock bool) {
	if err := s.repo.SetChatLang(ctx, chatID, domain.TelegramLang(languageCode)); err != nil {
		slog.WarnContext(ctx, "telegram: saving the language failed", "err", err)
	}
	if unblock {
		if err := s.repo.ClearChatBlocked(ctx, chatID); err != nil {
			slog.WarnContext(ctx, "telegram: clearing blocked failed", "err", err)
		}
	}
}

// alreadyBoundHere: the code did not bind, because it was used already, and by this very chat (its
// user still has this chat): Start pressed again on an old link. Nothing changes. A lookup error
// counts as no (the "expired" reply).
func (s *TelegramService) alreadyBoundHere(ctx context.Context, code string, chatID int64) bool {
	if !domain.IsLinkCode(code) {
		return false
	}
	bound, found, err := s.repo.UsedCodeChat(ctx, code)
	if err != nil {
		slog.WarnContext(ctx, "telegram: code lookup failed", "err", err)
		return false
	}
	return found && bound == chatID
}

type botMessage int

const (
	botLinked botMessage = iota
	botExpired
	botHint
	botLinkedBonus // %d: the photo credits given
	botAlreadyLinked
	botStopped
	botResumed
)

var botTexts = map[string][7]string{
	"ru": {
		"Готово! Telegram подключён к вашему аккаунту yodla.",
		"Код устарел или уже использован. Нажмите «Подключить» в профиле ещё раз.",
		"Чтобы подключить Telegram, откройте профиль на yodla.fun и нажмите «Подключить».",
		"Готово! Telegram подключён к вашему аккаунту yodla. В подарок: +%d фото для добавления слов.",
		"Telegram уже подключён ✅",
		"Уведомления выключены. Включить: /resume",
		"Уведомления включены. Выключить: /stop",
	},
	"uz": {
		"Tayyor! Telegram yodla hisobingizga ulandi.",
		"Kod eskirgan yoki allaqachon ishlatilgan. Profilda «Ulash» tugmasini yana bosing.",
		"Telegramni ulash uchun yodla.fun saytida profilni oching va «Ulash» tugmasini bosing.",
		"Tayyor! Telegram yodla hisobingizga ulandi. Sovg‘a: so‘z qo‘shish uchun +%d ta surat.",
		"Telegram allaqachon ulangan ✅",
		"Bildirishnomalar o‘chirildi. Yoqish: /resume",
		"Bildirishnomalar yoqildi. O‘chirish: /stop",
	},
	"en": {
		"Done! Telegram is now connected to your yodla account.",
		"This code has expired or was already used. Press Connect in your profile again.",
		"To connect Telegram, open your profile on yodla.fun and press Connect.",
		"Done! Telegram is now connected to your yodla account. Your gift: +%d photos for adding words.",
		"Telegram is already connected ✅",
		"Notifications are off. Turn them on: /resume",
		"Notifications are on. Turn them off: /stop",
	},
}

// botText picks the reply by Telegram's language_code ("ru", "uz", "en-US"…); anything else is English.
func botText(languageCode string, m botMessage) string {
	return botTexts[botLang(languageCode)][m]
}

// botLang maps Telegram's language_code to the bot's languages: ru, uz, anything else en.
func botLang(languageCode string) string {
	lang := strings.ToLower(languageCode)
	if i := strings.IndexAny(lang, "-_"); i >= 0 {
		lang = lang[:i]
	}
	if lang == "ru" || lang == "uz" {
		return lang
	}
	return "en"
}

// isBlocked: Telegram refused a message with 403.
func isBlocked(err error) bool { return errors.Is(err, domain.ErrBotBlocked) }
