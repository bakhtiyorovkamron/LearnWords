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
	PushURLMax       = 500
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

// NewPushPayload trims and validates a notification. url is optional ("/cards"); when given it must be
// a path inside the app: it starts with "/" and is neither "//host" nor a scheme.
func NewPushPayload(title, body, url string) (PushPayload, error) {
	bad := func(format string, a ...any) (PushPayload, error) {
		return PushPayload{}, fmt.Errorf("%w: %s", ErrValidation, fmt.Sprintf(format, a...))
	}
	p := PushPayload{Title: strings.TrimSpace(title), Body: strings.TrimSpace(body), URL: strings.TrimSpace(url)}
	if n := utf8.RuneCountInString(p.Title); n < 1 || n > PushTitleMax {
		return bad("title must be 1-%d characters", PushTitleMax)
	}
	if n := utf8.RuneCountInString(p.Body); n < 1 || n > PushBodyMax {
		return bad("body must be 1-%d characters", PushBodyMax)
	}
	if p.URL == "" {
		p.URL = PushDefaultURL
	}
	if len(p.URL) > PushURLMax || !strings.HasPrefix(p.URL, "/") ||
		strings.HasPrefix(p.URL, "//") || strings.HasPrefix(p.URL, `/\`) || strings.ContainsAny(p.URL, "\r\n\t") {
		return bad("url must be a path inside the app, like /cards")
	}
	return p, nil
}

// PushResult is the outcome of one send: delivered, failed (kept for the next time) and removed
// (the push service said the subscription is gone).
type PushResult struct {
	Sent    int `json:"sent"`
	Failed  int `json:"failed"`
	Removed int `json:"removed"`
}
