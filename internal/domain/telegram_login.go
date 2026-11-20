package domain

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"io"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
)

// Signing in with Telegram: the site creates a login (a visible code for the t.me link and a secret
// only the browser gets), the bot asks the chat, the "yes" button confirms, the browser collects the
// session with the secret. See migrations/000057_telegram_logins.up.sql.
const (
	// TelegramLoginPrefix + TelegramLoginCodeLen characters of TelegramLoginAlphabet: the t.me start
	// parameter ("login_" + 32 = 38 characters; Telegram allows 64 of [A-Za-z0-9_-]).
	TelegramLoginPrefix   = "login_"
	TelegramLoginCodeLen  = 32
	TelegramLoginAlphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
	// TelegramLoginSecretBytes: random bytes of the secret (base64url without padding: 43 characters).
	TelegramLoginSecretBytes = 32
	// TelegramLoginTTL: how long a login can be asked, confirmed and collected.
	TelegramLoginTTL = 5 * time.Minute
	// TelegramDeviceMax: characters of the device line ("iPhone · Safari").
	TelegramDeviceMax = 60
	// DeviceUnknownBrowser: the device line when the browser is not recognised (the bot translates it).
	DeviceUnknownBrowser = "браузер"
)

// The statuses of a login (telegram_logins.status).
const (
	LoginPending   = "pending"   // created, nobody pressed Start yet
	LoginAsked     = "asked"     // the bot asked a chat (chat_id is set)
	LoginConfirmed = "confirmed" // "yes" from that chat: user_id is set, the session can be collected
	LoginDenied    = "denied"    // "no", or the account is banned
	LoginUsed      = "used"      // the session was collected
)

// What polling a login answers the browser.
const (
	PollPending = "pending" // keep waiting
	PollDenied  = "denied"  // declined in Telegram (or banned)
	PollExpired = "expired" // unknown, timed out or already collected: start a new login
	PollOK      = "ok"      // signed in (tokens issued)
)

// ErrLanguageChosen: the learning language of this account is already set (409).
var ErrLanguageChosen = errors.New("the learning language is already chosen")

// TelegramLogin is one sign-in attempt.
type TelegramLogin struct {
	Code       string
	SecretHash []byte
	Device     string
	Status     string
	ChatID     *int64
	UserID     *uuid.UUID
	NewUser    bool
	ExpiresAt  time.Time
	CreatedAt  time.Time
}

// TelegramLoginStart is what the browser gets: the deep link, the secret and when the link expires.
type TelegramLoginStart struct {
	URL       string    `json:"url"`
	Secret    string    `json:"secret"`
	ExpiresAt time.Time `json:"expires_at"`
}

// TelegramLoginPoll is the answer to a poll; Tokens and NewUser only with PollOK.
type TelegramLoginPoll struct {
	Status  string
	Tokens  TokenPair
	NewUser bool
}

// TelegramProfile is what Telegram says about the person (the account created for an unknown chat).
type TelegramProfile struct {
	ChatID    int64
	Username  *string // nil when the Telegram account has none
	FullName  *string // first + last name; nil when empty
	Lang      string  // ru | uz | en
	CreatedAt time.Time
}

// NewTelegramLoginCode returns a fresh code read from src (crypto/rand.Reader when nil). Bytes of 248
// and above are skipped, so every character of the 62 is equally likely.
func NewTelegramLoginCode(src io.Reader) (string, error) {
	if src == nil {
		src = rand.Reader
	}
	const limit = 256 - 256%len(TelegramLoginAlphabet) // 248 = 4 × 62
	var b strings.Builder
	b.WriteString(TelegramLoginPrefix)
	buf := make([]byte, TelegramLoginCodeLen)
	for n := 0; n < TelegramLoginCodeLen; {
		if _, err := io.ReadFull(src, buf); err != nil {
			return "", err
		}
		for _, v := range buf {
			if int(v) >= limit || n == TelegramLoginCodeLen {
				continue
			}
			b.WriteByte(TelegramLoginAlphabet[int(v)%len(TelegramLoginAlphabet)])
			n++
		}
	}
	return b.String(), nil
}

// IsTelegramLoginCode reports whether s looks like a code NewTelegramLoginCode makes (checked
// before touching the DB).
func IsTelegramLoginCode(s string) bool {
	if !strings.HasPrefix(s, TelegramLoginPrefix) || len(s) != len(TelegramLoginPrefix)+TelegramLoginCodeLen {
		return false
	}
	for i := len(TelegramLoginPrefix); i < len(s); i++ {
		if strings.IndexByte(TelegramLoginAlphabet, s[i]) < 0 {
			return false
		}
	}
	return true
}

// NewTelegramLoginSecret returns a fresh secret (base64url, no padding) and its hash.
func NewTelegramLoginSecret(src io.Reader) (secret string, hash []byte, err error) {
	if src == nil {
		src = rand.Reader
	}
	raw := make([]byte, TelegramLoginSecretBytes)
	if _, err := io.ReadFull(src, raw); err != nil {
		return "", nil, err
	}
	sum := sha256.Sum256(raw)
	return base64.RawURLEncoding.EncodeToString(raw), sum[:], nil
}

// TelegramLoginSecretHash is the stored hash of a secret the browser sends; ok = false when it is
// not a secret NewTelegramLoginSecret makes (then nothing is looked up).
func TelegramLoginSecretHash(secret string) (hash []byte, ok bool) {
	raw, err := base64.RawURLEncoding.DecodeString(secret)
	if err != nil || len(raw) != TelegramLoginSecretBytes {
		return nil, false
	}
	sum := sha256.Sum256(raw)
	return sum[:], true
}

// TelegramEmailDomain: accounts created by Telegram get "tg<chat_id>" + this as their email. It is
// not a real mailbox and is never shown to the user; registering with it is refused.
const TelegramEmailDomain = "@telegram.yodla.fun"

// TelegramEmail is the email of the account created for a Telegram chat.
func TelegramEmail(chatID int64) string {
	return "tg" + strconv.FormatInt(chatID, 10) + TelegramEmailDomain
}

// IsTelegramEmail reports whether email belongs to an account created by Telegram.
func IsTelegramEmail(email string) bool {
	return strings.HasSuffix(strings.ToLower(strings.TrimSpace(email)), TelegramEmailDomain)
}

// TelegramFullName joins Telegram's first and last name (trimmed, at most MaxNameLen characters);
// nil when both are empty.
func TelegramFullName(first, last string) *string {
	name := strings.Join(strings.Fields(first+" "+last), " ")
	if name == "" {
		return nil
	}
	name = truncateRunes(name, MaxNameLen)
	return &name
}

// DeviceFromUserAgent names the device and the browser of a User-Agent for the bot's question:
// "iPhone · Safari", "Windows · Chrome", "Android · Telegram". An unknown browser is
// DeviceUnknownBrowser, an unknown system is left out. At most TelegramDeviceMax characters.
func DeviceFromUserAgent(ua string) string {
	parts := make([]string, 0, 2)
	if sys := uaSystem(ua); sys != "" {
		parts = append(parts, sys)
	}
	parts = append(parts, uaBrowser(ua))
	return truncateRunes(strings.Join(parts, " · "), TelegramDeviceMax)
}

func uaSystem(ua string) string {
	switch {
	case strings.Contains(ua, "iPhone") || strings.Contains(ua, "iPod"):
		return "iPhone"
	case strings.Contains(ua, "iPad"):
		return "iPad"
	case strings.Contains(ua, "Android"):
		return "Android"
	case strings.Contains(ua, "Windows"):
		return "Windows"
	case strings.Contains(ua, "Macintosh") || strings.Contains(ua, "Mac OS X"):
		return "Mac"
	case strings.Contains(ua, "Linux") || strings.Contains(ua, "X11"):
		return "Linux"
	}
	return ""
}

// uaBrowser: in-app browsers first (they also say Safari or Chrome), then Edge and the others before
// Chrome (Edge and Opera also say Chrome), Safari last (everything on iOS says Safari).
func uaBrowser(ua string) string {
	has := func(subs ...string) bool {
		for _, s := range subs {
			if strings.Contains(ua, s) {
				return true
			}
		}
		return false
	}
	switch {
	case has("Telegram"):
		return "Telegram"
	case has("Instagram"):
		return "Instagram"
	case has("Edg/", "EdgA/", "EdgiOS/", "Edge/"):
		return "Edge"
	case has("Firefox/", "FxiOS/"):
		return "Firefox"
	case has("Chrome/", "CriOS/", "Chromium/"):
		return "Chrome"
	case has("Safari/"):
		return "Safari"
	}
	return DeviceUnknownBrowser
}

func truncateRunes(s string, n int) string {
	if utf8.RuneCountInString(s) <= n {
		return s
	}
	return strings.TrimSpace(string([]rune(s)[:n]))
}
