package domain

import (
	"crypto/rand"
	"errors"
	"fmt"
	"io"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
)

// ErrTelegramUnavailable: the bot is not configured (no TELEGRAM_BOT_TOKEN / TELEGRAM_BOT_USERNAME).
var ErrTelegramUnavailable = errors.New("telegram is not configured")

// ErrBotBlocked: Telegram refused a message with 403 (the user blocked the bot, deactivated their
// account, or the chat is gone).
var ErrBotBlocked = errors.New("telegram: the bot is blocked")

// RetryAfterError: Telegram answered 429; wait Seconds before sending again.
type RetryAfterError struct{ Seconds int }

func (e *RetryAfterError) Error() string {
	return fmt.Sprintf("telegram: too many requests, retry after %d s", e.Seconds)
}

var (
	// ErrTelegramNotLinked: "me" as a broadcast target needs the admin's own Telegram.
	ErrTelegramNotLinked = errors.New("telegram is not linked")
	// ErrBroadcastRunning: only one broadcast to everyone may be queued or running.
	ErrBroadcastRunning = errors.New("a broadcast to everyone is already queued or running")
)

// TelegramButton is an inline button with a link under a message.
type TelegramButton struct {
	Text string `json:"text"`
	URL  string `json:"url"`
}

const (
	BroadcastTargetMe    = "me"
	BroadcastTargetAll   = "all"
	BroadcastTargetUsers = "users"

	BroadcastQueued      = "queued"
	BroadcastRunning     = "running"
	BroadcastDone        = "done"
	BroadcastInterrupted = "interrupted"

	RecipientPending = "pending"
	RecipientSent    = "sent"
	RecipientFailed  = "failed"
	RecipientBlocked = "blocked"

	// BroadcastTextMax: characters of one language's text; BroadcastButtonMax: of the button label.
	BroadcastTextMax   = 1000
	BroadcastButtonMax = 40
	// BroadcastMaxUsers: ids in the "users" target.
	BroadcastMaxUsers = 200
)

// TelegramBroadcast is a message an admin sent (or is sending) to Telegram users. Total, Sent, Failed
// and Blocked count recipients; the text of each is picked by the recipient's Telegram language.
type TelegramBroadcast struct {
	ID         int64           `json:"id"`
	AdminID    *uuid.UUID      `json:"admin_id"`
	Kind       string          `json:"kind"`
	Target     string          `json:"target"`
	Text       BroadcastText   `json:"text"`
	Button     *TelegramButton `json:"button"`
	Status     string          `json:"status"`
	Total      int             `json:"total"`
	Sent       int             `json:"sent"`
	Failed     int             `json:"failed"`
	Blocked    int             `json:"blocked"`
	CreatedAt  time.Time       `json:"created_at"`
	FinishedAt *time.Time      `json:"finished_at"`
}

// BroadcastText: Russian is required, the others fall back to it.
type BroadcastText struct {
	RU string  `json:"ru"`
	UZ *string `json:"uz"`
	EN *string `json:"en"`
}

// For returns the text for a Telegram language ("ru", "uz", "en"; anything else or a missing
// translation is Russian).
func (t BroadcastText) For(lang string) string {
	switch {
	case lang == "uz" && t.UZ != nil && *t.UZ != "":
		return *t.UZ
	case lang == "en" && t.EN != nil && *t.EN != "":
		return *t.EN
	}
	return t.RU
}

// BroadcastParams is what an admin asks for (already validated).
type BroadcastParams struct {
	AdminID uuid.UUID
	Target  string
	UserIDs []uuid.UUID // the "users" target
	Text    BroadcastText
	Button  *TelegramButton
}

// BroadcastRecipient is a pending recipient with what sending needs. Reachable = false: no chat any
// more, or opted out / blocked / banned since the snapshot; Blocked: the user blocked the bot.
type BroadcastRecipient struct {
	UserID    uuid.UUID
	ChatID    *int64
	Lang      string
	Reachable bool
	Blocked   bool
	// Params: the placeholders' values of an automatic broadcast (nil for a manual one: its text is sent as written).
	Params map[string]string
}

// TelegramAudience: how many users linked Telegram, and who of them can get a broadcast.
type TelegramAudience struct {
	Linked    int `json:"linked"`
	Reachable int `json:"reachable"`
	OptedOut  int `json:"opted_out"`
	Blocked   int `json:"blocked"`
}

// TelegramLang maps Telegram's language_code ("ru", "uz-UZ", "en-US") to ru, uz or en; anything else is ru.
func TelegramLang(code string) string {
	code = strings.ToLower(code)
	if i := strings.IndexAny(code, "-_"); i >= 0 {
		code = code[:i]
	}
	switch code {
	case "uz", "en":
		return code
	}
	return "ru"
}

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

// The automatic notification rules (telegram_rules).
const (
	RuleReviewReminder   = "review_reminder"
	RuleComeback         = "comeback"
	RulePurchasePaid     = "purchase_paid"
	RulePurchaseRejected = "purchase_rejected"

	// RuleWindow: a daily rule that was due more than this long ago is skipped for the day.
	RuleWindow = 3 * time.Hour
	// Quiet hours: a daily rule never goes out from RuleQuietFrom to RuleQuietTo local time.
	RuleQuietFromHour = 22
	RuleQuietToHour   = 8
	// RuleMaxUnanswered: reminders in a row without a review after which a user gets no more.
	RuleMaxUnanswered = 3
	// RuleAbsenceDays: no activity for this long makes the "come back" message due.
	RuleAbsenceDays = 7
)

// RuleDef describes one rule: whether it runs every day at send_at, and the placeholders its text may use.
type RuleDef struct {
	Key          string
	Daily        bool
	Placeholders []string
}

var RuleDefs = []RuleDef{
	{RuleReviewReminder, true, []string{"name", "count"}},
	{RuleComeback, true, []string{"name", "count"}},
	{RulePurchasePaid, false, []string{"name", "code", "amount"}},
	{RulePurchaseRejected, false, []string{"name", "code", "amount"}},
}

// RuleDefOf returns the rule with this key.
func RuleDefOf(key string) (RuleDef, bool) {
	for _, d := range RuleDefs {
		if d.Key == key {
			return d, true
		}
	}
	return RuleDef{}, false
}

// TelegramRule is an automatic notification an admin switches on and edits. SendAt is "HH:MM" local
// time (daily rules only); LastRunOn the local day it last ran ("2006-01-02"); LastSent the messages
// sent by that run.
type TelegramRule struct {
	Key          string          `json:"key"`
	Enabled      bool            `json:"enabled"`
	SendAt       *string         `json:"send_at"`
	Text         BroadcastText   `json:"text"`
	Button       *TelegramButton `json:"button"`
	Placeholders []string        `json:"placeholders"`
	LastRunOn    *string         `json:"last_run_on"`
	LastSent     *int            `json:"last_sent"`
}

// RuleError is a validation error of one field of a rule (400 with a code and the field).
type RuleError struct {
	Code  string // invalid_placeholder, invalid_send_at, invalid_text, invalid_button
	Field string // ru, uz, en, send_at, button
	Msg   string
}

func (e *RuleError) Error() string { return e.Msg }
func (e *RuleError) Unwrap() error { return ErrValidation }

var placeholderRe = regexp.MustCompile(`\{([^{}]*)\}`)
var spacesRe = regexp.MustCompile(` {2,}`)

// Placeholders returns the names used in {braces} in text.
func Placeholders(text string) []string {
	var out []string
	for _, m := range placeholderRe.FindAllStringSubmatch(text, -1) {
		out = append(out, m[1])
	}
	return out
}

// RenderTemplate fills {name}-style placeholders from params; an unknown one is left as it is. A
// leading ", " (an empty {name} at the start) and double spaces are cleaned up.
func RenderTemplate(text string, params map[string]string) string {
	out := placeholderRe.ReplaceAllStringFunc(text, func(m string) string {
		if v, ok := params[m[1:len(m)-1]]; ok {
			return v
		}
		return m
	})
	out = strings.TrimSpace(spacesRe.ReplaceAllString(out, " "))
	return strings.TrimSpace(strings.TrimPrefix(out, ", "))
}
