package domain

import (
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/google/uuid"
)

// Chats with the admins: each user's support thread and the thread of each purchase request.
const (
	ChatKindSupport  = "support"
	ChatKindPurchase = "purchase"

	ChatAuthorUser   = "user" // the user (in a purchase thread: the buyer)
	ChatAuthorAdmin  = "admin"
	ChatAuthorSystem = "system"

	// HiddenCardNumber: why a message is hidden — its text looks like a card number.
	HiddenCardNumber = "card_number"

	ChatEventPaid      = "paid"      // purchase system line: an admin confirmed the payment
	ChatEventCancelled = "cancelled" // purchase system line: rejected by an admin or cancelled by the buyer

	MaxChatBody  = 1000 // characters of one message
	ChatPageSize = 50   // messages in one read

	ChatPreviewMax    = 80 // characters of the last message in the admins' thread list
	ChatHiddenPreview = "[скрыто]"
	ChatPhotoPreview  = "[фото]"
)

// ErrChatClosed: the request is cancelled or rejected, so no new messages (the history stays readable).
var ErrChatClosed = errors.New("the purchase request is cancelled: its chat is closed")

// ChatMessage is one line of a chat. Body and ImageKey: at least one is set (a system line has a
// body and an Event).
type ChatMessage struct {
	ID           int64
	ThreadID     int64
	AuthorRole   string
	AuthorUserID *uuid.UUID
	Body         *string
	ImageKey     *string
	Hidden       bool
	HiddenReason *string
	Event        *string
	CreatedAt    time.Time
}

// VisibleTo: a hidden message is seen by the admins and by its author's side only.
func (m ChatMessage) VisibleTo(viewerRole string) bool {
	return !m.Hidden || viewerRole == ChatAuthorAdmin || m.AuthorRole == viewerRole
}

// ChatImage is a photo attached to a message; the message keeps only Key.
type ChatImage struct {
	Key         string
	ContentType string
	Data        []byte
}

// ChatThread is a conversation of one user with the admins. The admins' listing also fills the
// user's email, the unread count (the user's messages after the newest one an admin has read) and
// the last message.
type ChatThread struct {
	ID                int64
	Kind              string
	UserID            uuid.UUID
	PurchaseRequestID *uuid.UUID
	LastMessageAt     *time.Time
	CreatedAt         time.Time

	UserEmail   string
	Unread      int
	LastMessage *ChatMessage
}

// ChatPreview is how the admins' list shows a message: hidden ones as "[скрыто]", a photo alone as
// "[фото]", text on one line and cut to ChatPreviewMax characters.
func ChatPreview(m ChatMessage) string {
	if m.Hidden {
		return ChatHiddenPreview
	}
	if m.Body == nil {
		return ChatPhotoPreview
	}
	text := strings.Join(strings.Fields(*m.Body), " ")
	if utf8.RuneCountInString(text) <= ChatPreviewMax {
		return text
	}
	return string([]rune(text)[:ChatPreviewMax-1]) + "…"
}

// ChatOpen: new messages are allowed unless the request was cancelled or rejected.
func ChatOpen(status string) bool { return status != PurchaseCancelled && status != PurchaseRejected }

// System lines, stored in Russian (the client shows Event in the user's language).
const ChatCancelledText = "Заявка отменена"

func ChatPaidText(amount int) string {
	return fmt.Sprintf("Оплата подтверждена, +%d фото", amount)
}

// fourByFour: four groups of four digits, each pair split by at most one character that is neither
// a digit nor a letter ("8600.1234.5678.9012"), not glued to more digits on either side.
var fourByFour = regexp.MustCompile(`(?:^|[^\p{N}])\p{N}{4}(?:[^\p{N}\p{L}]?\p{N}{4}){3}(?:[^\p{N}]|$)`)

// LooksLikeCardNumber: the text has a run of 13–19 digits in which single spaces or dashes may sit
// between the digits ("8600 1234 5678 9012", "8600-1234-5678-9012", "8600123456789012"), or four
// groups of four digits. 25000, "25 000" or a phone number (12 digits) do not count. Every chat
// uses it: such a message is stored hidden.
func LooksLikeCardNumber(s string) bool {
	if fourByFour.MatchString(s) {
		return true
	}
	digits, afterSep := 0, false
	for _, r := range s {
		switch {
		case unicode.IsDigit(r):
			digits++
			afterSep = false
		case digits > 0 && !afterSep && (r == '-' || r == '–' || unicode.IsSpace(r)):
			afterSep = true // one separator may continue the run
		default:
			if digits >= 13 && digits <= 19 {
				return true
			}
			digits, afterSep = 0, false
		}
	}
	return digits >= 13 && digits <= 19
}
