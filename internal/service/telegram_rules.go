package service

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"

	"learnwords/internal/domain"
)

// RuleDay is "today" for a daily rule: the local calendar day (Today, a date), its first instant
// (Start) and now.
type RuleDay struct {
	Today time.Time
	Start time.Time
	Now   time.Time
}

// RuleRecipient is where a service message goes: the user's chat, Telegram language and name.
type RuleRecipient struct {
	ChatID int64
	Lang   string
	Name   string
}

// TelegramRulesRepository stores the rules and finds who a run is for.
type TelegramRulesRepository interface {
	Rules(ctx context.Context) ([]domain.TelegramRule, error)
	Rule(ctx context.Context, key string) (domain.TelegramRule, error)
	SaveRule(ctx context.Context, rule domain.TelegramRule) (domain.TelegramRule, error)
	// ClaimRun takes today's run of an enabled rule: true for exactly one caller per day.
	ClaimRun(ctx context.Context, key string, today time.Time) (bool, error)
	ReleaseRun(ctx context.Context, key string, today time.Time) error
	CountRuleAudience(ctx context.Context, key string, day RuleDay) (int, error)
	// CreateRuleBroadcast queues the run as a broadcast to its audience; nil = nobody to write to.
	CreateRuleBroadcast(ctx context.Context, rule domain.TelegramRule, day RuleDay) (*domain.TelegramBroadcast, error)
	// Recipient: the user's chat for a service message (found = false without Telegram or after a 403).
	Recipient(ctx context.Context, userID uuid.UUID) (RuleRecipient, bool, error)
	MarkBlocked(ctx context.Context, userID uuid.UUID) error
}

// TelegramRulesService edits the automatic notification rules and runs them: a scheduler wakes every
// minute and starts the daily rules in their window, and the purchase rules fire on a decision.
type TelegramRulesService struct {
	repo    TelegramRulesRepository
	bot     TelegramBot
	enabled bool
	loc     *time.Location
	wake    func() // tells the broadcast worker something was queued
	now     func() time.Time
	every   time.Duration
	wg      sync.WaitGroup
}

func NewTelegramRulesService(repo TelegramRulesRepository, bot TelegramBot, enabled bool, loc *time.Location, wake func()) *TelegramRulesService {
	if loc == nil {
		loc = time.UTC
	}
	return &TelegramRulesService{repo: repo, bot: bot, enabled: enabled && bot != nil, loc: loc, wake: wake, now: time.Now, every: time.Minute}
}

// parseClock reads "HH:MM" into minutes after midnight.
func parseClock(s string) (int, bool) {
	t, err := time.Parse("15:04", s)
	if err != nil {
		return 0, false
	}
	return t.Hour()*60 + t.Minute(), true
}

func fieldErr(code, field, format string, a ...any) error {
	return &domain.RuleError{Code: code, Field: field, Msg: fmt.Sprintf(format, a...)}
}

// ValidateRule checks and normalises an edited rule: the texts (the Russian one required, ≤ 1000
// characters, only the rule's placeholders), the button, and send_at (daily rules only, 08:00–21:59).
func ValidateRule(def domain.RuleDef, enabled bool, sendAt *string, ru, uz, en string, button *domain.TelegramButton) (domain.TelegramRule, error) {
	rule := domain.TelegramRule{Key: def.Key, Enabled: enabled, Placeholders: def.Placeholders}
	switch {
	case def.Daily:
		if sendAt == nil || strings.TrimSpace(*sendAt) == "" {
			return rule, fieldErr("invalid_send_at", "send_at", "send_at is required for a daily rule")
		}
		m, ok := parseClock(strings.TrimSpace(*sendAt))
		if !ok {
			return rule, fieldErr("invalid_send_at", "send_at", "send_at must look like 19:00")
		}
		if m < domain.RuleQuietToHour*60 || m >= domain.RuleQuietFromHour*60 {
			return rule, fieldErr("invalid_send_at", "send_at", "no notifications between %02d:00 and %02d:00: choose a time from %02d:00 to %02d:59",
				domain.RuleQuietFromHour, domain.RuleQuietToHour, domain.RuleQuietToHour, domain.RuleQuietFromHour-1)
		}
		clock := fmt.Sprintf("%02d:%02d", m/60, m%60)
		rule.SendAt = &clock
	case sendAt != nil && strings.TrimSpace(*sendAt) != "":
		return rule, fieldErr("invalid_send_at", "send_at", "this rule has no time: it runs on an event")
	}
	for _, x := range []struct{ field, text string }{{"ru", ru}, {"uz", uz}, {"en", en}} {
		t := strings.TrimSpace(x.text)
		if t == "" && x.field == "ru" {
			return rule, fieldErr("invalid_text", "ru", "text ru is required")
		}
		if utf8.RuneCountInString(t) > domain.BroadcastTextMax {
			return rule, fieldErr("invalid_text", x.field, "text %s is at most %d characters", x.field, domain.BroadcastTextMax)
		}
		for _, name := range domain.Placeholders(t) {
			if !contains(def.Placeholders, name) {
				return rule, fieldErr("invalid_placeholder", x.field, "unknown placeholder {%s}: use only %s", name, placeholderList(def.Placeholders))
			}
		}
		switch x.field {
		case "ru":
			rule.Text.RU = t
		case "uz":
			if t != "" {
				rule.Text.UZ = &t
			}
		case "en":
			if t != "" {
				rule.Text.EN = &t
			}
		}
	}
	if button != nil && (strings.TrimSpace(button.Text) != "" || strings.TrimSpace(button.URL) != "") {
		_, b, err := ValidateBroadcast("x", "", "", button)
		if err != nil {
			return rule, fieldErr("invalid_button", "button", "%s", strings.TrimPrefix(err.Error(), domain.ErrValidation.Error()+": "))
		}
		rule.Button = b
	}
	return rule, nil
}

func contains(xs []string, s string) bool {
	for _, x := range xs {
		if x == s {
			return true
		}
	}
	return false
}

func placeholderList(xs []string) string {
	out := make([]string, len(xs))
	for i, x := range xs {
		out[i] = "{" + x + "}"
	}
	return strings.Join(out, " ")
}

// Rules lists the rules.
func (s *TelegramRulesService) Rules(ctx context.Context) ([]domain.TelegramRule, error) {
	return s.repo.Rules(ctx)
}

// Update saves a rule an admin edited (validated first); ErrNotFound for an unknown key.
func (s *TelegramRulesService) Update(ctx context.Context, key string, enabled bool, sendAt *string, ru, uz, en string, button *domain.TelegramButton) (domain.TelegramRule, error) {
	def, ok := domain.RuleDefOf(key)
	if !ok {
		return domain.TelegramRule{}, domain.ErrNotFound
	}
	rule, err := ValidateRule(def, enabled, sendAt, ru, uz, en, button)
	if err != nil {
		return domain.TelegramRule{}, err
	}
	return s.repo.SaveRule(ctx, rule)
}

func (s *TelegramRulesService) day(now time.Time) RuleDay {
	l := now.In(s.loc)
	start := time.Date(l.Year(), l.Month(), l.Day(), 0, 0, 0, 0, s.loc)
	return RuleDay{Today: time.Date(l.Year(), l.Month(), l.Day(), 0, 0, 0, 0, time.UTC), Start: start, Now: now}
}

// Preview: how many users a daily rule would reach if it ran now.
func (s *TelegramRulesService) Preview(ctx context.Context, key string) (int, error) {
	def, ok := domain.RuleDefOf(key)
	if !ok {
		return 0, domain.ErrNotFound
	}
	if !def.Daily {
		return 0, fmt.Errorf("%w: only daily rules have a preview", domain.ErrValidation)
	}
	return s.repo.CountRuleAudience(ctx, key, s.day(s.now()))
}

// sampleParams: what a test message shows.
func sampleParams(name string) map[string]string {
	return map[string]string{"name": name, "count": "12", "code": "YD-0000", "amount": "35"}
}

// render picks the text for a language and fills in the values.
func render(rule domain.TelegramRule, lang string, params map[string]string) string {
	return domain.RenderTemplate(rule.Text.For(lang), params)
}

// Test sends the rule's text, with sample values, to the calling admin's own Telegram.
func (s *TelegramRulesService) Test(ctx context.Context, adminID uuid.UUID, key string) error {
	if !s.enabled {
		return domain.ErrTelegramUnavailable
	}
	rule, err := s.repo.Rule(ctx, key)
	if err != nil {
		return err
	}
	to, found, err := s.repo.Recipient(ctx, adminID)
	if err != nil {
		return err
	}
	if !found {
		return domain.ErrTelegramNotLinked
	}
	return s.bot.SendMessage(ctx, to.ChatID, render(rule, to.Lang, sampleParams(to.Name)), rule.Button)
}

// SendPurchaseEvent sends the purchase_paid / purchase_rejected text to the buyer when that rule is
// enabled. It is a service message: the buyer's notifications switch does not matter, a blocked bot
// does. sent = true only when Telegram took the message; a failure is logged, never returned.
func (s *TelegramRulesService) SendPurchaseEvent(ctx context.Context, key string, p domain.PurchaseRequest) bool {
	if !s.enabled {
		return false
	}
	rule, err := s.repo.Rule(ctx, key)
	if err != nil {
		slog.WarnContext(ctx, "telegram: reading a rule failed", "rule", key, "err", err)
		return false
	}
	if !rule.Enabled {
		return false
	}
	to, found, err := s.repo.Recipient(ctx, p.UserID)
	if err != nil || !found {
		if err != nil {
			slog.WarnContext(ctx, "telegram: finding the buyer's chat failed", "err", err)
		}
		return false
	}
	params := map[string]string{"name": to.Name, "code": p.Code, "amount": fmt.Sprint(p.Amount), "count": ""}
	if err := s.bot.SendMessage(ctx, to.ChatID, render(rule, to.Lang, params), rule.Button); err != nil {
		if isBlocked(err) {
			if merr := s.repo.MarkBlocked(ctx, p.UserID); merr != nil {
				slog.WarnContext(ctx, "telegram: marking blocked failed", "err", merr)
			}
		}
		slog.WarnContext(ctx, "telegram: a purchase message failed", "rule", key, "err", err)
		return false
	}
	return true
}

// Start runs the scheduler until ctx ends; Wait blocks until it has stopped.
func (s *TelegramRulesService) Start(ctx context.Context) {
	if !s.enabled {
		return
	}
	s.wg.Add(1)
	go func() {
		defer s.wg.Done()
		s.Tick(ctx, s.now())
		t := time.NewTicker(s.every)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case now := <-t.C:
				s.Tick(ctx, now)
			}
		}
	}()
}

// Wait blocks until the scheduler has stopped (tests; graceful shutdown).
func (s *TelegramRulesService) Wait() { s.wg.Wait() }

// inWindow: a daily rule due at sendAt (minutes after midnight) may start now — from sendAt for 3
// hours, and never in the quiet hours.
func (s *TelegramRulesService) inWindow(now time.Time, sendAt int) bool {
	l := now.In(s.loc)
	m := l.Hour()*60 + l.Minute()
	end := min(sendAt+int(domain.RuleWindow/time.Minute), domain.RuleQuietFromHour*60)
	return m >= sendAt && m < end && m >= domain.RuleQuietToHour*60
}

// Tick starts every enabled daily rule that is due at `now` and has not run today. The claim is one
// atomic UPDATE, so two instances (or a restart) never run a rule twice in a day.
func (s *TelegramRulesService) Tick(ctx context.Context, now time.Time) {
	rules, err := s.repo.Rules(ctx)
	if err != nil {
		if ctx.Err() == nil {
			slog.ErrorContext(ctx, "telegram: reading the rules failed", "err", err)
		}
		return
	}
	day := s.day(now)
	for _, rule := range rules {
		def, ok := domain.RuleDefOf(rule.Key)
		if !ok || !def.Daily || !rule.Enabled || rule.SendAt == nil {
			continue
		}
		at, ok := parseClock(*rule.SendAt)
		if !ok || !s.inWindow(now, at) {
			continue
		}
		if rule.LastRunOn != nil && *rule.LastRunOn >= day.Today.Format("2006-01-02") {
			continue
		}
		claimed, err := s.repo.ClaimRun(ctx, rule.Key, day.Today)
		if err != nil || !claimed {
			if err != nil {
				slog.ErrorContext(ctx, "telegram: claiming a rule failed", "rule", rule.Key, "err", err)
			}
			continue
		}
		b, err := s.repo.CreateRuleBroadcast(ctx, rule, day)
		if err != nil {
			slog.ErrorContext(ctx, "telegram: starting a rule failed", "rule", rule.Key, "err", err)
			if rerr := s.repo.ReleaseRun(context.WithoutCancel(ctx), rule.Key, day.Today); rerr != nil { // a later minute tries again
				slog.ErrorContext(ctx, "telegram: giving a claim back failed", "rule", rule.Key, "err", rerr)
			}
			continue
		}
		if b == nil {
			slog.InfoContext(ctx, "telegram: a rule had nobody to write to", "rule", rule.Key)
			continue
		}
		slog.InfoContext(ctx, "telegram: a rule started", "rule", rule.Key, "broadcast", b.ID, "recipients", b.Total)
		if s.wake != nil {
			s.wake()
		}
	}
}
