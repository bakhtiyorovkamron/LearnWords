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
}

// TelegramBot is the Bot API (provider/telegram).
type TelegramBot interface {
	SendMessage(ctx context.Context, chatID int64, text string) error
	SetWebhook(ctx context.Context, url, secret string) error
}

// TelegramUpdate is the part of a Bot API update the bot reads.
type TelegramUpdate struct {
	Message *struct {
		Text string `json:"text"`
		Chat struct {
			ID   int64  `json:"id"`
			Type string `json:"type"`
		} `json:"chat"`
		From *struct {
			Username     string `json:"username"`
			LanguageCode string `json:"language_code"`
		} `json:"from"`
	} `json:"message"`
}

// TelegramService links a site account to Telegram: the profile asks for a deep link
// (t.me/<bot>?start=<code>), the user presses Start, the webhook binds the chat.
type TelegramService struct {
	repo        TelegramRepository
	bot         TelegramBot // nil = not configured
	botUsername string
	now         func() time.Time
	random      io.Reader // nil = crypto/rand
}

func NewTelegramService(repo TelegramRepository, bot TelegramBot, botUsername string) *TelegramService {
	return &TelegramService{repo: repo, bot: bot, botUsername: strings.TrimPrefix(strings.TrimSpace(botUsername), "@"), now: time.Now}
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

// RegisterWebhook points the bot at url (no-op when the bot or the url is not configured).
func (s *TelegramService) RegisterWebhook(ctx context.Context, url, secret string) error {
	if !s.Enabled() || url == "" {
		return nil
	}
	return s.bot.SetWebhook(ctx, url, secret)
}

// HandleUpdate reacts to "/start <code>" (bind) and a bare "/start" (a hint) in private chats;
// everything else is ignored. It never fails the webhook: Telegram would resend the update.
func (s *TelegramService) HandleUpdate(ctx context.Context, u TelegramUpdate) {
	m := u.Message
	if m == nil || m.Chat.Type != "private" || !s.Enabled() {
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
	var reply string
	switch {
	case text == "/start":
		reply = botText(lang, botHint)
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
	if err := s.bot.SendMessage(ctx, m.Chat.ID, reply); err != nil {
		slog.WarnContext(ctx, "telegram: reply failed", "err", err)
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
)

var botTexts = map[string][5]string{
	"ru": {
		"Готово! Telegram подключён к вашему аккаунту yodla.",
		"Код устарел или уже использован. Нажмите «Подключить» в профиле ещё раз.",
		"Чтобы подключить Telegram, откройте профиль на yodla.fun и нажмите «Подключить».",
		"Готово! Telegram подключён к вашему аккаунту yodla. В подарок: +%d фото для добавления слов.",
		"Telegram уже подключён ✅",
	},
	"uz": {
		"Tayyor! Telegram yodla hisobingizga ulandi.",
		"Kod eskirgan yoki allaqachon ishlatilgan. Profilda «Ulash» tugmasini yana bosing.",
		"Telegramni ulash uchun yodla.fun saytida profilni oching va «Ulash» tugmasini bosing.",
		"Tayyor! Telegram yodla hisobingizga ulandi. Sovg‘a: so‘z qo‘shish uchun +%d ta surat.",
		"Telegram allaqachon ulangan ✅",
	},
	"en": {
		"Done! Telegram is now connected to your yodla account.",
		"This code has expired or was already used. Press Connect in your profile again.",
		"To connect Telegram, open your profile on yodla.fun and press Connect.",
		"Done! Telegram is now connected to your yodla account. Your gift: +%d photos for adding words.",
		"Telegram is already connected ✅",
	},
}

// botText picks the reply by Telegram's language_code ("ru", "uz", "en-US"…); anything else is English.
func botText(languageCode string, m botMessage) string {
	lang := strings.ToLower(languageCode)
	if i := strings.IndexAny(lang, "-_"); i >= 0 {
		lang = lang[:i]
	}
	t, ok := botTexts[lang]
	if !ok {
		t = botTexts["en"]
	}
	return t[m]
}
