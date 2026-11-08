package domain

import (
	"errors"
	"regexp"
	"strings"
	"unicode/utf8"
)

// Profile errors; the handler answers 400 with the code "invalid_name" / "invalid_phone".
var (
	ErrInvalidName  = errors.New("invalid name")
	ErrInvalidPhone = errors.New("invalid phone")
)

const (
	MinNameLen = 2
	MaxNameLen = 80
)

// Profile is the user's own data: name, phone and Telegram. Nothing else belongs here.
type Profile struct {
	FullName         *string
	Phone            *string // E.164, +998XXXXXXXXX
	TelegramUsername *string // set by the bot only (nil when the Telegram account has none)
	// TelegramConnected: the bot has bound a private chat (users.telegram_chat_id is set).
	TelegramConnected bool
}

var phoneRe = regexp.MustCompile(`^\+998\d{9}$`)

// NormalizeName trims the name and checks its length (2..80 characters, not bytes).
func NormalizeName(s string) (string, error) {
	s = strings.TrimSpace(s)
	if n := utf8.RuneCountInString(s); n < MinNameLen || n > MaxNameLen {
		return "", ErrInvalidName
	}
	return s, nil
}

// NormalizePhone removes spaces and dashes and requires +998 and 9 digits. An empty phone is
// allowed (the field is optional): it comes back as "".
func NormalizePhone(s string) (string, error) {
	s = strings.NewReplacer(" ", "", "-", "").Replace(strings.TrimSpace(s))
	if s == "" {
		return "", nil
	}
	if !phoneRe.MatchString(s) {
		return "", ErrInvalidPhone
	}
	return s, nil
}
