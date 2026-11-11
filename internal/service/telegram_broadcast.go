package service

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/url"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"

	"learnwords/internal/domain"
)

const (
	// broadcastPace: the time between two messages (about 20 a second, under Telegram's limit).
	broadcastPace = 50 * time.Millisecond
	// broadcastBatch: recipients read at a time; counters are refreshed every broadcastFlush sends.
	broadcastBatch = 100
	broadcastFlush = 20
	// broadcastIdlePoll: how often an idle worker looks for a queued broadcast anyway.
	broadcastIdlePoll = 10 * time.Second
	// broadcastListLimit: the history the admin page shows.
	broadcastListLimit = 20
)

// TelegramBroadcastRepository stores broadcasts and their recipients.
type TelegramBroadcastRepository interface {
	Audience(ctx context.Context) (domain.TelegramAudience, error)
	// CreateBroadcast stores the broadcast (queued) and snapshots its recipients; skipped = the asked
	// "users" that cannot get it. ErrTelegramNotLinked, ErrBroadcastRunning.
	CreateBroadcast(ctx context.Context, p domain.BroadcastParams) (domain.TelegramBroadcast, int, error)
	// ClaimNext marks the oldest queued broadcast running and returns it (nil = none).
	ClaimNext(ctx context.Context) (*domain.TelegramBroadcast, error)
	PendingRecipients(ctx context.Context, id int64, target string, limit int) ([]domain.BroadcastRecipient, error)
	SetRecipient(ctx context.Context, id int64, userID uuid.UUID, status string) error
	MarkUserBlocked(ctx context.Context, userID uuid.UUID) error
	RefreshCounters(ctx context.Context, id int64) error
	Finish(ctx context.Context, id int64, status string) error
	InterruptUnfinished(ctx context.Context) error
	List(ctx context.Context, limit int) ([]domain.TelegramBroadcast, error)
	Get(ctx context.Context, id int64) (domain.TelegramBroadcast, error)
}

// TelegramBroadcastService sends an admin's message to Telegram users. A single background worker
// sends one broadcast at a time, about 20 messages a second; each recipient is stored with its result,
// so nobody gets the same broadcast twice. A restart or shutdown leaves a broadcast 'interrupted' and
// it is never resumed by itself.
type TelegramBroadcastService struct {
	repo    TelegramBroadcastRepository
	bot     TelegramBot
	enabled bool

	pace  time.Duration
	sleep func(ctx context.Context, d time.Duration) bool // false = the context ended first
	wake  chan struct{}
	wg    sync.WaitGroup
}

func NewTelegramBroadcastService(repo TelegramBroadcastRepository, bot TelegramBot, enabled bool) *TelegramBroadcastService {
	return &TelegramBroadcastService{repo: repo, bot: bot, enabled: enabled && bot != nil, pace: broadcastPace,
		sleep: sleepCtx, wake: make(chan struct{}, 1)}
}

func sleepCtx(ctx context.Context, d time.Duration) bool {
	if d <= 0 {
		return ctx.Err() == nil
	}
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-t.C:
		return true
	}
}

// Enabled: the bot is configured.
func (s *TelegramBroadcastService) Enabled() bool { return s.enabled }

// Audience: who linked Telegram and who can get a broadcast.
func (s *TelegramBroadcastService) Audience(ctx context.Context) (domain.TelegramAudience, error) {
	if !s.enabled {
		return domain.TelegramAudience{}, domain.ErrTelegramUnavailable
	}
	return s.repo.Audience(ctx)
}

// List: the last broadcasts, newest first.
func (s *TelegramBroadcastService) List(ctx context.Context) ([]domain.TelegramBroadcast, error) {
	if !s.enabled {
		return nil, domain.ErrTelegramUnavailable
	}
	return s.repo.List(ctx, broadcastListLimit)
}

// Get: one broadcast with its live counters.
func (s *TelegramBroadcastService) Get(ctx context.Context, id int64) (domain.TelegramBroadcast, error) {
	if !s.enabled {
		return domain.TelegramBroadcast{}, domain.ErrTelegramUnavailable
	}
	return s.repo.Get(ctx, id)
}

func invalid(format string, a ...any) error {
	return fmt.Errorf("%w: %s", domain.ErrValidation, fmt.Sprintf(format, a...))
}

// cleanText trims a text and checks its length; required = it must not be empty.
func cleanText(name, text string, required bool) (string, error) {
	text = strings.TrimSpace(text)
	if text == "" && required {
		return "", invalid("text %s is required", name)
	}
	if utf8.RuneCountInString(text) > domain.BroadcastTextMax {
		return "", invalid("text %s is at most %d characters", name, domain.BroadcastTextMax)
	}
	return text, nil
}

// ValidateBroadcast checks and normalises the texts and the button (both fields or none; the link is https).
func ValidateBroadcast(ru, uz, en string, button *domain.TelegramButton) (domain.BroadcastText, *domain.TelegramButton, error) {
	var out domain.BroadcastText
	var err error
	if out.RU, err = cleanText("ru", ru, true); err != nil {
		return out, nil, err
	}
	for _, x := range []struct {
		name string
		in   string
		to   **string
	}{{"uz", uz, &out.UZ}, {"en", en, &out.EN}} {
		t, err := cleanText(x.name, x.in, false)
		if err != nil {
			return out, nil, err
		}
		if t != "" {
			*x.to = &t
		}
	}
	if button == nil || (strings.TrimSpace(button.Text) == "" && strings.TrimSpace(button.URL) == "") {
		return out, nil, nil
	}
	b := domain.TelegramButton{Text: strings.TrimSpace(button.Text), URL: strings.TrimSpace(button.URL)}
	if b.Text == "" || b.URL == "" {
		return out, nil, invalid("a button needs both a label and a link")
	}
	if n := utf8.RuneCountInString(b.Text); n > domain.BroadcastButtonMax {
		return out, nil, invalid("the button label is at most %d characters", domain.BroadcastButtonMax)
	}
	if u, err := url.Parse(b.URL); err != nil || u.Scheme != "https" || u.Host == "" || len(b.URL) > 512 {
		return out, nil, invalid("the button link must be an https address")
	}
	return out, &b, nil
}

// Create validates and queues a broadcast, snapshotting its recipients. Returns it with `skipped`: the
// asked users that cannot get it (unknown, no Telegram, opted out, blocked, banned). Errors:
// ErrTelegramUnavailable, ErrValidation, ErrTelegramNotLinked ("me" without the admin's Telegram),
// ErrBroadcastRunning (a second "all").
func (s *TelegramBroadcastService) Create(ctx context.Context, adminID uuid.UUID, target string, userIDs []uuid.UUID,
	ru, uz, en string, button *domain.TelegramButton) (domain.TelegramBroadcast, int, error) {
	if !s.enabled {
		return domain.TelegramBroadcast{}, 0, domain.ErrTelegramUnavailable
	}
	text, btn, err := ValidateBroadcast(ru, uz, en, button)
	if err != nil {
		return domain.TelegramBroadcast{}, 0, err
	}
	p := domain.BroadcastParams{AdminID: adminID, Target: target, Text: text, Button: btn}
	switch target {
	case domain.BroadcastTargetMe, domain.BroadcastTargetAll:
	case domain.BroadcastTargetUsers:
		seen := map[uuid.UUID]bool{}
		for _, id := range userIDs {
			if !seen[id] {
				seen[id] = true
				p.UserIDs = append(p.UserIDs, id)
			}
		}
		if len(p.UserIDs) < 1 || len(p.UserIDs) > domain.BroadcastMaxUsers {
			return domain.TelegramBroadcast{}, 0, invalid("user_ids must hold 1-%d user ids", domain.BroadcastMaxUsers)
		}
	default:
		return domain.TelegramBroadcast{}, 0, invalid(`target must be "me", "all" or "users"`)
	}
	b, skipped, err := s.repo.CreateBroadcast(ctx, p)
	if err != nil {
		return domain.TelegramBroadcast{}, 0, err
	}
	select {
	case s.wake <- struct{}{}:
	default:
	}
	return b, skipped, nil
}

// Start marks every broadcast a restart cut off 'interrupted' (never resumed) and starts the worker,
// which stops when ctx ends. Wait blocks until it has.
func (s *TelegramBroadcastService) Start(ctx context.Context) error {
	if !s.enabled {
		return nil
	}
	if err := s.repo.InterruptUnfinished(ctx); err != nil {
		return err
	}
	s.wg.Add(1)
	go func() {
		defer s.wg.Done()
		s.run(ctx)
	}()
	return nil
}

// Wait blocks until the worker has stopped (tests; graceful shutdown).
func (s *TelegramBroadcastService) Wait() { s.wg.Wait() }

func (s *TelegramBroadcastService) run(ctx context.Context) {
	for ctx.Err() == nil {
		b, err := s.repo.ClaimNext(ctx)
		if err != nil && ctx.Err() == nil {
			slog.ErrorContext(ctx, "telegram: reading the broadcast queue failed", "err", err)
		}
		if b != nil {
			s.send(ctx, *b)
			continue
		}
		select {
		case <-ctx.Done():
			return
		case <-s.wake:
		case <-time.After(broadcastIdlePoll):
		}
	}
}

// interrupt ends a broadcast the worker could not finish; ctx is probably cancelled, so it uses its own.
func (s *TelegramBroadcastService) interrupt(id int64) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := s.repo.RefreshCounters(ctx, id); err != nil {
		slog.Error("telegram: refreshing broadcast counters failed", "broadcast", id, "err", err)
	}
	if err := s.repo.Finish(ctx, id, domain.BroadcastInterrupted); err != nil {
		slog.Error("telegram: interrupting a broadcast failed", "broadcast", id, "err", err)
	}
}

// send works through the pending recipients of one broadcast. A recipient is written down right after
// its message, so an interruption never makes anyone get it twice.
func (s *TelegramBroadcastService) send(ctx context.Context, b domain.TelegramBroadcast) {
	done := 0
	for {
		recs, err := s.repo.PendingRecipients(ctx, b.ID, b.Target, broadcastBatch)
		if err != nil {
			if ctx.Err() == nil {
				slog.ErrorContext(ctx, "telegram: reading broadcast recipients failed", "broadcast", b.ID, "err", err)
			}
			s.interrupt(b.ID)
			return
		}
		if len(recs) == 0 {
			break
		}
		for _, r := range recs {
			status := s.deliver(ctx, b, r)
			if status == "" { // the context ended
				s.interrupt(b.ID)
				return
			}
			if err := s.repo.SetRecipient(ctx, b.ID, r.UserID, status); err != nil {
				slog.ErrorContext(ctx, "telegram: saving a recipient failed", "broadcast", b.ID, "err", err)
				s.interrupt(b.ID)
				return
			}
			if done++; done%broadcastFlush == 0 {
				if err := s.repo.RefreshCounters(ctx, b.ID); err != nil {
					slog.WarnContext(ctx, "telegram: refreshing broadcast counters failed", "broadcast", b.ID, "err", err)
				}
			}
			if !s.sleep(ctx, s.pace) {
				s.interrupt(b.ID)
				return
			}
		}
	}
	fin, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer cancel()
	if err := s.repo.RefreshCounters(fin, b.ID); err != nil {
		slog.Error("telegram: refreshing broadcast counters failed", "broadcast", b.ID, "err", err)
	}
	if err := s.repo.Finish(fin, b.ID, domain.BroadcastDone); err != nil {
		slog.Error("telegram: finishing a broadcast failed", "broadcast", b.ID, "err", err)
	}
}

// deliver sends one message and returns the recipient's status ("" when the context ended). A 429 is
// waited out and retried once; a 403 marks the user blocked.
func (s *TelegramBroadcastService) deliver(ctx context.Context, b domain.TelegramBroadcast, r domain.BroadcastRecipient) string {
	if !r.Reachable || r.ChatID == nil {
		if r.Blocked {
			return domain.RecipientBlocked
		}
		return domain.RecipientFailed
	}
	text := b.Text.For(r.Lang)
	err := s.bot.SendMessage(ctx, *r.ChatID, text, b.Button)
	var retry *domain.RetryAfterError
	if errors.As(err, &retry) {
		if !s.sleep(ctx, time.Duration(retry.Seconds)*time.Second) {
			return ""
		}
		err = s.bot.SendMessage(ctx, *r.ChatID, text, b.Button)
	}
	switch {
	case err == nil:
		return domain.RecipientSent
	case ctx.Err() != nil:
		return ""
	case errors.Is(err, domain.ErrBotBlocked):
		if merr := s.repo.MarkUserBlocked(ctx, r.UserID); merr != nil {
			slog.WarnContext(ctx, "telegram: marking blocked failed", "err", merr)
		}
		return domain.RecipientBlocked
	default:
		slog.WarnContext(ctx, "telegram: broadcast message failed", "broadcast", b.ID, "err", err) // the client scrubbed the token
		return domain.RecipientFailed
	}
}
