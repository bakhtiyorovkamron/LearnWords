package service

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"unicode/utf8"

	"github.com/SherClockHolmes/webpush-go"
	"github.com/google/uuid"

	"learnwords/internal/domain"
)

type PushRepository interface {
	Upsert(ctx context.Context, userID uuid.UUID, endpoint, p256dh, auth, userAgent string) error
	DeleteOwn(ctx context.Context, userID uuid.UUID, endpoint string) error
	DeleteEndpoint(ctx context.Context, endpoint string) error
	MarkSuccess(ctx context.Context, endpoint string) error
	All(ctx context.Context) ([]domain.PushSubscription, error)
	ByUser(ctx context.Context, userID uuid.UUID) ([]domain.PushSubscription, error)
	Stats(ctx context.Context) (devices, users int, err error)
}

const (
	pushTTLSeconds = 24 * 60 * 60 // the push service keeps an undelivered message for a day
	pushParallel   = 8
	pushKeyMaxLen  = 256
)

// PushService stores subscriptions and sends Web Push notifications (VAPID).
type PushService struct {
	repo       PushRepository
	public     string
	private    string
	subject    string
	httpClient webpush.HTTPClient // nil = http.DefaultClient
}

// PushOption customizes a PushService.
type PushOption func(*PushService)

// WithPushHTTPClient replaces the HTTP client used to reach push services (tests).
func WithPushHTTPClient(c webpush.HTTPClient) PushOption {
	return func(s *PushService) { s.httpClient = c }
}

func NewPushService(repo PushRepository, publicKey, privateKey, subject string, opts ...PushOption) *PushService {
	s := &PushService{repo: repo, public: publicKey, private: privateKey, subject: subject}
	for _, o := range opts {
		o(s)
	}
	return s
}

// Enabled: both VAPID keys are configured.
func (s *PushService) Enabled() bool { return s.public != "" && s.private != "" }

// PublicKey is what the browser needs to subscribe.
func (s *PushService) PublicKey() (string, error) {
	if !s.Enabled() {
		return "", domain.ErrPushDisabled
	}
	return s.public, nil
}

// Subscribe stores (or moves) a device. The endpoint must be an https URL — browsers only hand out those.
func (s *PushService) Subscribe(ctx context.Context, userID uuid.UUID, endpoint, p256dh, auth, userAgent string) error {
	if !s.Enabled() {
		return domain.ErrPushDisabled
	}
	endpoint, p256dh, auth = strings.TrimSpace(endpoint), strings.TrimSpace(p256dh), strings.TrimSpace(auth)
	bad := func(msg string) error { return fmt.Errorf("%w: %s", domain.ErrValidation, msg) }
	u, err := url.Parse(endpoint)
	if err != nil || u.Scheme != "https" || u.Host == "" || len(endpoint) > domain.PushEndpointMax {
		return bad(fmt.Sprintf("endpoint must be an https URL of at most %d characters", domain.PushEndpointMax))
	}
	if p256dh == "" || auth == "" || len(p256dh) > pushKeyMaxLen || len(auth) > pushKeyMaxLen {
		return bad("keys.p256dh and keys.auth are required")
	}
	return s.repo.Upsert(ctx, userID, endpoint, p256dh, auth, trimUserAgent(userAgent))
}

func trimUserAgent(ua string) string {
	ua = strings.TrimSpace(ua)
	if utf8.RuneCountInString(ua) > domain.PushUserAgentMax {
		ua = string([]rune(ua)[:domain.PushUserAgentMax])
	}
	return ua
}

// Unsubscribe removes the caller's own device (someone else's endpoint is ignored).
func (s *PushService) Unsubscribe(ctx context.Context, userID uuid.UUID, endpoint string) error {
	endpoint = strings.TrimSpace(endpoint)
	if endpoint == "" {
		return fmt.Errorf("%w: endpoint is required", domain.ErrValidation)
	}
	return s.repo.DeleteOwn(ctx, userID, endpoint)
}

// Stats: subscribed devices and distinct users (works with push switched off too).
func (s *PushService) Stats(ctx context.Context) (devices, users int, err error) {
	return s.repo.Stats(ctx)
}

// SendTo validates the notification and sends it to every device (target "all") or to one user's devices.
func (s *PushService) SendTo(ctx context.Context, target, title, body, link string) (domain.PushResult, error) {
	if !s.Enabled() {
		return domain.PushResult{}, domain.ErrPushDisabled
	}
	payload, err := domain.NewPushPayload(title, body, link)
	if err != nil {
		return domain.PushResult{}, err
	}
	var subs []domain.PushSubscription
	if target == "all" {
		subs, err = s.repo.All(ctx)
	} else {
		id, perr := uuid.Parse(target)
		if perr != nil {
			return domain.PushResult{}, fmt.Errorf("%w: target must be \"all\" or a user id", domain.ErrValidation)
		}
		subs, err = s.repo.ByUser(ctx, id)
	}
	if err != nil {
		return domain.PushResult{}, err
	}
	return s.Send(ctx, subs, payload), nil
}

// Send delivers payload to every subscription, up to 8 at a time. A 404/410 from the push service
// means the device is gone: the subscription is deleted (removed). Any other failure is logged and
// counted (failed) and the subscription is kept. A 2xx stamps last_success_at.
func (s *PushService) Send(ctx context.Context, subs []domain.PushSubscription, payload domain.PushPayload) domain.PushResult {
	message, _ := json.Marshal(payload)
	opts := &webpush.Options{
		Subscriber: s.subject, VAPIDPublicKey: s.public, VAPIDPrivateKey: s.private,
		TTL: pushTTLSeconds, Urgency: webpush.UrgencyNormal, HTTPClient: s.httpClient,
	}
	var (
		mu     sync.Mutex
		result domain.PushResult
		wg     sync.WaitGroup
		slots  = make(chan struct{}, pushParallel)
	)
	for _, sub := range subs {
		wg.Add(1)
		slots <- struct{}{}
		go func() {
			defer wg.Done()
			defer func() { <-slots }()
			outcome := s.sendOne(ctx, sub, message, opts)
			mu.Lock()
			defer mu.Unlock()
			switch outcome {
			case pushSent:
				result.Sent++
			case pushRemoved:
				result.Removed++
			default:
				result.Failed++
			}
		}()
	}
	wg.Wait()
	return result
}

type pushOutcome int

const (
	pushSent pushOutcome = iota
	pushFailed
	pushRemoved
)

func (s *PushService) sendOne(ctx context.Context, sub domain.PushSubscription, message []byte, opts *webpush.Options) pushOutcome {
	resp, err := webpush.SendNotificationWithContext(ctx, message,
		&webpush.Subscription{Endpoint: sub.Endpoint, Keys: webpush.Keys{P256dh: sub.P256dh, Auth: sub.Auth}}, opts)
	if err != nil {
		slog.WarnContext(ctx, "web push failed", "subscription", sub.ID, "user_id", sub.UserID, "err", err)
		return pushFailed
	}
	defer resp.Body.Close()
	bg := context.WithoutCancel(ctx) // the bookkeeping must survive a cancelled request
	switch {
	case resp.StatusCode == http.StatusNotFound || resp.StatusCode == http.StatusGone:
		if err := s.repo.DeleteEndpoint(bg, sub.Endpoint); err != nil {
			slog.ErrorContext(ctx, "web push: deleting a gone subscription failed", "subscription", sub.ID, "err", err)
		}
		return pushRemoved
	case resp.StatusCode >= 200 && resp.StatusCode < 300:
		if err := s.repo.MarkSuccess(bg, sub.Endpoint); err != nil {
			slog.ErrorContext(ctx, "web push: stamping last_success_at failed", "subscription", sub.ID, "err", err)
		}
		return pushSent
	default:
		slog.WarnContext(ctx, "web push rejected", "subscription", sub.ID, "user_id", sub.UserID, "status", resp.StatusCode)
		return pushFailed
	}
}
