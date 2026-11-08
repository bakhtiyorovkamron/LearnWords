package domain

import (
	"crypto/rand"
	"errors"
	"io"
	"strings"
	"time"
)

// ErrTelegramUnavailable: the bot is not configured (no TELEGRAM_BOT_TOKEN / TELEGRAM_BOT_USERNAME).
var ErrTelegramUnavailable = errors.New("telegram is not configured")

const (
	// LinkCodePrefix + LinkCodeLen characters of LinkCodeAlphabet: "YL-K7QX2M".
	LinkCodePrefix = "YL-"
	LinkCodeLen    = 6
	// LinkCodeAlphabet: A-Z and 2-9 without the look-alikes 0/O and 1/I. 32 characters, so a random
	// byte maps onto it with no bias (256 = 8 × 32).
	LinkCodeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
	// LinkCodeTTL: how long a deep link works.
	LinkCodeTTL = 10 * time.Minute
	// TelegramBonusCredits: photo import credits given once for connecting Telegram (once per
	// Telegram account and once per user).
	TelegramBonusCredits = 2
	// CreditReasonTelegram: the credit_ledger reason of that gift.
	CreditReasonTelegram = "telegram"
)

// NewLinkCode returns a fresh one-time code read from src (crypto/rand.Reader when nil).
func NewLinkCode(src io.Reader) (string, error) {
	if src == nil {
		src = rand.Reader
	}
	buf := make([]byte, LinkCodeLen)
	if _, err := io.ReadFull(src, buf); err != nil {
		return "", err
	}
	var b strings.Builder
	b.WriteString(LinkCodePrefix)
	for _, v := range buf {
		b.WriteByte(LinkCodeAlphabet[int(v)%len(LinkCodeAlphabet)])
	}
	return b.String(), nil
}

// IsLinkCode reports whether s looks like a code NewLinkCode makes (checked before touching the DB).
func IsLinkCode(s string) bool {
	if !strings.HasPrefix(s, LinkCodePrefix) || len(s) != len(LinkCodePrefix)+LinkCodeLen {
		return false
	}
	for _, r := range s[len(LinkCodePrefix):] {
		if !strings.ContainsRune(LinkCodeAlphabet, r) {
			return false
		}
	}
	return true
}

// LinkCodeActive: a code works until it is used or its time is up (expires_at itself is too late).
func LinkCodeActive(expiresAt time.Time, usedAt *time.Time, now time.Time) bool {
	return usedAt == nil && now.Before(expiresAt)
}

// TelegramLink is a created deep link.
type TelegramLink struct {
	Code      string    `json:"-"`
	URL       string    `json:"url"`
	ExpiresAt time.Time `json:"expires_at"`
}
