package domain

import (
	"errors"
	"fmt"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"
)

// ErrPushDisabled: the VAPID keys are not configured, Web Push is switched off.
var ErrPushDisabled = errors.New("web push is not configured")

// PushSubscription is one browser/device that agreed to receive notifications.
type PushSubscription struct {
	ID       uuid.UUID
	UserID   uuid.UUID
	Endpoint string
	P256dh   string
	Auth     string
}

// Limits of a push notification.
const (
	PushTitleMax     = 60
	PushBodyMax      = 200
	PushEndpointMax  = 2048
	PushUserAgentMax = 200
	PushDefaultURL   = "/cards"
	pushKeyMaxLen    = 256
)

// PushPayload is what the service worker receives: it shows title and body, and opens url on a tap.
type PushPayload struct {
	Title string `json:"title"`
	Body  string `json:"body"`
	URL   string `json:"url"`
}

// NewPushPayload trims and validates a notification. The tap always opens PushDefaultURL: the
// address is not up to the sender.
func NewPushPayload(title, body string) (PushPayload, error) {
	p := PushPayload{Title: strings.TrimSpace(title), Body: strings.TrimSpace(body), URL: PushDefaultURL}
	if n := utf8.RuneCountInString(p.Title); n < 1 || n > PushTitleMax {
		return PushPayload{}, fmt.Errorf("%w: title must be 1-%d characters", ErrValidation, PushTitleMax)
	}
	if n := utf8.RuneCountInString(p.Body); n < 1 || n > PushBodyMax {
		return PushPayload{}, fmt.Errorf("%w: body must be 1-%d characters", ErrValidation, PushBodyMax)
	}
	return p, nil
}

// PushResult is the outcome of one send: delivered, failed (kept for the next time) and removed
// (the push service said the subscription is gone). Users is how many distinct people had devices.
type PushResult struct {
	Sent    int `json:"sent"`
	Failed  int `json:"failed"`
	Removed int `json:"removed"`
	Users   int `json:"users"`
}
