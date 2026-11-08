package domain

import (
	"errors"
	"fmt"
	"regexp"
	"time"
	"unicode"

	"github.com/google/uuid"
)

// The chat inside a purchase request: the buyer, the admins and system lines.
const (
	ChatAuthorBuyer  = "buyer"
	ChatAuthorAdmin  = "admin"
	ChatAuthorSystem = "system"

	// HiddenCardNumber: why a message is hidden — its text looks like a card number.
	HiddenCardNumber = "card_number"

	ChatEventPaid      = "paid"      // system: an admin confirmed the payment
	ChatEventCancelled = "cancelled" // system: rejected by an admin or cancelled by the buyer

	MaxChatBody  = 1000 // characters of one message
	ChatPageSize = 50   // messages in one read
)

// ErrChatClosed: the request is cancelled or rejected, so no new messages (the history stays readable).
var ErrChatClosed = errors.New("the purchase request is cancelled: its chat is closed")

// PurchaseMessage is one line of a purchase chat. Body and ImageKey: at least one is set (a system
// line has a body and an Event).
type PurchaseMessage struct {
	ID           int64
	RequestID    uuid.UUID
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
func (m PurchaseMessage) VisibleTo(viewerRole string) bool {
	return !m.Hidden || viewerRole == ChatAuthorAdmin || m.AuthorRole == viewerRole
}

// ChatImage is a photo attached to a message; the message keeps only Key.
type ChatImage struct {
	Key         string
	ContentType string
	Data        []byte
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
// groups of four digits. 25000, "25 000" or a phone number (12 digits) do not count.
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
