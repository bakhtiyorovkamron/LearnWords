package service

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	"learnwords/internal/domain"
)

// memRules is the postgres rules repository in memory (the audience queries are tested there).
type memRules struct {
	mu        sync.Mutex
	rules     map[string]*domain.TelegramRule
	claimed   map[string]string // key → the day it was claimed
	created   []string          // keys of the broadcasts created
	audience  int               // recipients a run finds
	recips    map[uuid.UUID]RuleRecipient
	blocked   map[uuid.UUID]bool
	createErr error
	claims    int
}

func newMemRules() *memRules {
	m := &memRules{rules: map[string]*domain.TelegramRule{}, claimed: map[string]string{}, recips: map[uuid.UUID]RuleRecipient{}, blocked: map[uuid.UUID]bool{}}
	for _, d := range domain.RuleDefs {
		r := &domain.TelegramRule{Key: d.Key, Text: domain.BroadcastText{RU: "Слов: {count}"}, Placeholders: d.Placeholders}
		if d.Daily {
			at := "19:00"
			r.SendAt = &at
		}
		m.rules[d.Key] = r
	}
	return m
}

func (m *memRules) Rules(context.Context) ([]domain.TelegramRule, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []domain.TelegramRule
	for _, d := range domain.RuleDefs {
		r := *m.rules[d.Key]
		if day, ok := m.claimed[d.Key]; ok {
			r.LastRunOn = &day
		}
		out = append(out, r)
	}
	return out, nil
}

func (m *memRules) Rule(_ context.Context, key string) (domain.TelegramRule, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if r := m.rules[key]; r != nil {
		return *r, nil
	}
	return domain.TelegramRule{}, domain.ErrNotFound
}

func (m *memRules) SaveRule(_ context.Context, rule domain.TelegramRule) (domain.TelegramRule, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.rules[rule.Key] == nil {
		return domain.TelegramRule{}, domain.ErrNotFound
	}
	rule.Placeholders = m.rules[rule.Key].Placeholders
	m.rules[rule.Key] = &rule
	return rule, nil
}

func (m *memRules) ClaimRun(_ context.Context, key string, today time.Time) (bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.claims++
	day := today.Format("2006-01-02")
	if !m.rules[key].Enabled || m.claimed[key] >= day && m.claimed[key] != "" {
		return false, nil
	}
	m.claimed[key] = day
	return true, nil
}

func (m *memRules) ReleaseRun(_ context.Context, key string, today time.Time) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.claimed[key] == today.Format("2006-01-02") {
		delete(m.claimed, key)
	}
	return nil
}

func (m *memRules) CountRuleAudience(context.Context, string, RuleDay) (int, error) {
	return m.audience, nil
}

func (m *memRules) CreateRuleBroadcast(_ context.Context, rule domain.TelegramRule, _ RuleDay) (*domain.TelegramBroadcast, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.createErr != nil {
		return nil, m.createErr
	}
	if m.audience == 0 {
		return nil, nil
	}
	m.created = append(m.created, rule.Key)
	return &domain.TelegramBroadcast{ID: int64(len(m.created)), Kind: "auto:" + rule.Key, Total: m.audience}, nil
}

func (m *memRules) Recipient(_ context.Context, user uuid.UUID) (RuleRecipient, bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	r, ok := m.recips[user]
	return r, ok && !m.blocked[user], nil
}

func (m *memRules) MarkBlocked(_ context.Context, user uuid.UUID) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.blocked[user] = true
	return nil
}

func tashkent(t *testing.T) *time.Location {
	t.Helper()
	loc, err := time.LoadLocation("Asia/Tashkent")
	if err != nil {
		t.Fatal(err)
	}
	return loc
}

type rulesFixture struct {
	svc   *TelegramRulesService
	repo  *memRules
	bot   *fakeBot
	loc   *time.Location
	woken int
}

func newRulesFixture(t *testing.T) *rulesFixture {
	f := &rulesFixture{repo: newMemRules(), bot: &fakeBot{}, loc: tashkent(t)}
	f.svc = NewTelegramRulesService(f.repo, f.bot, true, f.loc, func() { f.woken++ })
	f.repo.audience = 5
	return f
}

func (f *rulesFixture) at(h, m int) time.Time { return time.Date(2026, 11, 10, h, m, 0, 0, f.loc) }

func (f *rulesFixture) enable(key string, enabled bool, sendAt string) {
	r := f.repo.rules[key]
	r.Enabled = enabled
	if sendAt != "" {
		r.SendAt = &sendAt
	}
}

func TestRules_RunsOnceAtSendAt_AndTheWindowIsThreeHours(t *testing.T) {
	f := newRulesFixture(t)
	f.enable(domain.RuleReviewReminder, true, "19:00")
	ctx := context.Background()

	f.svc.Tick(ctx, f.at(18, 59)) // not yet
	if len(f.repo.created) != 0 {
		t.Fatal("ran before send_at")
	}
	f.svc.Tick(ctx, f.at(19, 0))
	if len(f.repo.created) != 1 || f.woken != 1 {
		t.Fatalf("at send_at: %v woken %d", f.repo.created, f.woken)
	}
	f.svc.Tick(ctx, f.at(19, 1)) // the next minute: already ran today
	f.svc.Tick(ctx, f.at(20, 30))
	if len(f.repo.created) != 1 {
		t.Errorf("ran twice in a day: %v", f.repo.created)
	}
	// The next day it runs again.
	f.svc.Tick(ctx, f.at(19, 0).AddDate(0, 0, 1))
	if len(f.repo.created) != 2 {
		t.Errorf("next day: %v", f.repo.created)
	}

	// The window: 19:00 + 3 h would be 22:00, the quiet hours start there anyway.
	f2 := newRulesFixture(t)
	f2.enable(domain.RuleComeback, true, "12:00")
	f2.svc.Tick(ctx, f2.at(15, 0)) // exactly 3 h later: too late (a restart after downtime sends nothing)
	if len(f2.repo.created) != 0 {
		t.Error("ran 3 hours after send_at")
	}
	f2.svc.Tick(ctx, f2.at(14, 59)) // still inside the window
	if len(f2.repo.created) != 1 {
		t.Errorf("14:59: %v", f2.repo.created)
	}
}

func TestRules_NeverInTheQuietHours(t *testing.T) {
	f := newRulesFixture(t)
	f.enable(domain.RuleReviewReminder, true, "21:30")
	ctx := context.Background()
	f.svc.Tick(ctx, f.at(21, 59)) // the window would run to 00:30, but 22:00 ends it
	if len(f.repo.created) != 1 {
		t.Fatalf("21:59: %v", f.repo.created)
	}
	f2 := newRulesFixture(t)
	f2.enable(domain.RuleReviewReminder, true, "21:30")
	for _, at := range []time.Time{f2.at(22, 0), f2.at(23, 30), f2.at(1, 0), f2.at(7, 59)} {
		f2.svc.Tick(ctx, at)
	}
	if len(f2.repo.created) != 0 {
		t.Errorf("sent in the quiet hours: %v", f2.repo.created)
	}
	// Even a send_at stored in the night (an old row) does not send.
	f3 := newRulesFixture(t)
	f3.enable(domain.RuleReviewReminder, true, "23:00")
	f3.svc.Tick(ctx, f3.at(23, 10))
	f4 := newRulesFixture(t)
	f4.enable(domain.RuleReviewReminder, true, "06:00")
	f4.svc.Tick(ctx, f4.at(6, 30))
	if len(f3.repo.created)+len(f4.repo.created) != 0 {
		t.Error("a night time sent")
	}
}

func TestRules_DisabledRulesAndEventRulesNeverRun_NobodyMatchingStoresNothing(t *testing.T) {
	f := newRulesFixture(t)
	f.enable(domain.RuleReviewReminder, false, "19:00")
	f.enable(domain.RulePurchasePaid, true, "")
	f.svc.Tick(context.Background(), f.at(19, 5))
	if len(f.repo.created) != 0 {
		t.Errorf("created %v", f.repo.created)
	}
	f.enable(domain.RuleReviewReminder, true, "19:00")
	f.repo.audience = 0
	f.svc.Tick(context.Background(), f.at(19, 5))
	if len(f.repo.created) != 0 || f.woken != 0 {
		t.Errorf("an empty run: %v woken %d", f.repo.created, f.woken)
	}
}

func TestRules_TheClaimGivesOneCallerTheRun(t *testing.T) {
	f := newRulesFixture(t)
	f.enable(domain.RuleReviewReminder, true, "19:00")
	// Two instances (or a restart) tick at the same moment.
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			f.svc.Tick(context.Background(), f.at(19, 0))
		}()
	}
	wg.Wait()
	if len(f.repo.created) != 1 {
		t.Errorf("%d runs", len(f.repo.created))
	}
}

func TestRules_AFailedRunGivesTheClaimBack(t *testing.T) {
	f := newRulesFixture(t)
	f.enable(domain.RuleReviewReminder, true, "19:00")
	f.repo.createErr = errors.New("db down")
	f.svc.Tick(context.Background(), f.at(19, 0))
	f.repo.createErr = nil
	f.svc.Tick(context.Background(), f.at(19, 1))
	if len(f.repo.created) != 1 {
		t.Errorf("the next minute did not retry: %v", f.repo.created)
	}
}

func TestRules_SchedulerStartsAndStops(t *testing.T) {
	f := newRulesFixture(t)
	f.svc.every = 10 * time.Millisecond
	ctx, stop := context.WithCancel(context.Background())
	f.svc.Start(ctx)
	time.Sleep(50 * time.Millisecond)
	stop()
	f.svc.Wait()
	off := NewTelegramRulesService(f.repo, nil, false, f.loc, nil)
	off.Start(context.Background()) // no bot: nothing starts
	off.Wait()
}

func ptr(s string) *string { return &s }

func TestRules_Validation(t *testing.T) {
	daily, _ := domain.RuleDefOf(domain.RuleReviewReminder)
	event, _ := domain.RuleDefOf(domain.RulePurchasePaid)
	check := func(name string, err error, code, field string) {
		t.Helper()
		var re *domain.RuleError
		if !errors.As(err, &re) || re.Code != code || re.Field != field || !errors.Is(err, domain.ErrValidation) {
			t.Errorf("%s: %v (want %s on %s)", name, err, code, field)
		}
	}
	_, err := ValidateRule(daily, true, ptr("19:00"), "Слов: {count} {foo}", "", "", nil)
	check("unknown placeholder", err, "invalid_placeholder", "ru")
	_, err = ValidateRule(daily, true, ptr("19:00"), "ok {name}", "Salom {code}", "", nil)
	check("a placeholder of another rule in uz", err, "invalid_placeholder", "uz")
	_, err = ValidateRule(daily, true, ptr("19:00"), "x", "", "{amount}", nil)
	check("amount in a daily rule", err, "invalid_placeholder", "en")
	_, err = ValidateRule(event, true, nil, "{count}", "", "", nil)
	check("count in a purchase rule", err, "invalid_placeholder", "ru")
	for _, at := range []string{"22:00", "23:30", "00:00", "07:59", "03:00"} {
		_, err = ValidateRule(daily, true, ptr(at), "x", "", "", nil)
		check("quiet hours "+at, err, "invalid_send_at", "send_at")
	}
	for _, at := range []*string{nil, ptr(""), ptr("25:00"), ptr("noon")} {
		_, err = ValidateRule(daily, true, at, "x", "", "", nil)
		check("bad send_at", err, "invalid_send_at", "send_at")
	}
	_, err = ValidateRule(event, true, ptr("10:00"), "x", "", "", nil)
	check("a time for an event rule", err, "invalid_send_at", "send_at")
	_, err = ValidateRule(daily, true, ptr("19:00"), "  ", "", "", nil)
	check("no text", err, "invalid_text", "ru")
	_, err = ValidateRule(daily, true, ptr("19:00"), strings.Repeat("я", 1001), "", "", nil)
	check("long text", err, "invalid_text", "ru")
	_, err = ValidateRule(daily, true, ptr("19:00"), "x", strings.Repeat("a", 1001), "", nil)
	check("long uz", err, "invalid_text", "uz")
	_, err = ValidateRule(daily, true, ptr("19:00"), "x", "", "", &domain.TelegramButton{Text: "Open", URL: "http://x.co"})
	check("http button", err, "invalid_button", "button")

	// Valid: the edges of the time range, every allowed placeholder, trimmed, an empty button = none.
	for _, at := range []string{"08:00", "21:59"} {
		r, err := ValidateRule(daily, true, ptr(at), "Привет, {name}! {count}", "  ", "", &domain.TelegramButton{})
		if err != nil || *r.SendAt != at || r.Button != nil || r.Text.UZ != nil {
			t.Errorf("%s: %+v %v", at, r, err)
		}
	}
	r, err := ValidateRule(event, false, nil, " {name} {code} {amount} ", "", "", &domain.TelegramButton{Text: "Open", URL: "https://yodla.fun"})
	if err != nil || r.Text.RU != "{name} {code} {amount}" || r.SendAt != nil || r.Button == nil {
		t.Errorf("event rule: %+v %v", r, err)
	}
}

func TestRules_Templates(t *testing.T) {
	p := map[string]string{"name": "Anna", "count": "12"}
	if got := domain.RenderTemplate("{name}, слов: {count}", p); got != "Anna, слов: 12" {
		t.Errorf("%q", got)
	}
	empty := map[string]string{"name": "", "count": "12"}
	if got := domain.RenderTemplate("{name}, слов: {count}", empty); got != "слов: 12" {
		t.Errorf("empty name at the start: %q", got)
	}
	if got := domain.RenderTemplate("Привет, {name} , слов:  {count}", empty); got != "Привет, , слов: 12" {
		t.Errorf("double spaces: %q", got)
	}
	if got := domain.RenderTemplate("Hi {name}! {unknown}", p); got != "Hi Anna! {unknown}" {
		t.Errorf("unknown placeholders stay: %q", got)
	}
	if got := domain.RenderTemplate("Слов: {count}", p); got != "Слов: 12" {
		t.Errorf("%q", got)
	}
	// The language fallback.
	text := domain.BroadcastText{RU: "ru {count}", UZ: strp("uz {count}")}
	rule := domain.TelegramRule{Text: text}
	if render(rule, "uz", p) != "uz 12" || render(rule, "en", p) != "ru 12" || render(rule, "xx", p) != "ru 12" || render(rule, "ru", p) != "ru 12" {
		t.Error("language fallback")
	}
}

func TestRules_Test_SendsTheSampleToTheAdmin(t *testing.T) {
	f := newRulesFixture(t)
	admin := uuid.New()
	if err := f.svc.Test(context.Background(), admin, domain.RulePurchasePaid); !errors.Is(err, domain.ErrTelegramNotLinked) {
		t.Fatalf("an admin without Telegram: %v", err)
	}
	f.repo.rules[domain.RulePurchasePaid].Text = domain.BroadcastText{RU: "{name}: заявка {code}, фото {amount}", EN: strp("{name}: order {code}, photos {amount}")}
	f.repo.rules[domain.RuleReviewReminder].Button = &domain.TelegramButton{Text: "Открыть", URL: "https://yodla.fun"}
	f.repo.recips[admin] = RuleRecipient{ChatID: 99, Lang: "en", Name: "Boss"}
	if err := f.svc.Test(context.Background(), admin, domain.RulePurchasePaid); err != nil {
		t.Fatal(err)
	}
	if len(f.bot.sent) != 1 || f.bot.sent[0].chat != 99 || f.bot.sent[0].text != "Boss: order YD-0000, photos 35" {
		t.Errorf("sent %+v", f.bot.sent)
	}
	if err := f.svc.Test(context.Background(), admin, domain.RuleReviewReminder); err != nil || f.bot.sent[1].text != "Слов: 12" || f.bot.sent[1].button == nil {
		t.Errorf("review sample (count 12, the rule's button): %+v %v", f.bot.sent, err)
	}
	if err := f.svc.Test(context.Background(), admin, "nope"); !errors.Is(err, domain.ErrNotFound) {
		t.Errorf("unknown rule: %v", err)
	}
	off := NewTelegramRulesService(f.repo, nil, false, f.loc, nil)
	if err := off.Test(context.Background(), admin, domain.RulePurchasePaid); !errors.Is(err, domain.ErrTelegramUnavailable) {
		t.Errorf("no bot: %v", err)
	}
}

func TestRules_PurchaseEvent_OneMessage_IgnoresTheSwitch_ButNotBlocked(t *testing.T) {
	f := newRulesFixture(t)
	buyer := uuid.New()
	f.repo.recips[buyer] = RuleRecipient{ChatID: 7, Lang: "uz", Name: ""}
	f.repo.rules[domain.RulePurchasePaid].Text = domain.BroadcastText{RU: "Оплата {code}: {amount}", UZ: strp("{code} to‘lov: {amount}")}
	p := domain.PurchaseRequest{UserID: buyer, Code: "YD-4821", Amount: 35}
	ctx := context.Background()

	if f.svc.SendPurchaseEvent(ctx, domain.RulePurchasePaid, p) || len(f.bot.sent) != 0 {
		t.Fatal("a disabled rule sent")
	}
	f.repo.rules[domain.RulePurchasePaid].Enabled = true
	if !f.svc.SendPurchaseEvent(ctx, domain.RulePurchasePaid, p) || len(f.bot.sent) != 1 || f.bot.sent[0].text != "YD-4821 to‘lov: 35" {
		t.Fatalf("sent %+v", f.bot.sent)
	}
	// A Telegram failure is only reported as "not sent"; a 403 marks the user blocked and stops everything.
	f.bot.err = domain.ErrBotBlocked
	if f.svc.SendPurchaseEvent(ctx, domain.RulePurchasePaid, p) || !f.repo.blocked[buyer] {
		t.Error("a 403 did not mark the buyer blocked")
	}
	f.bot.err = nil
	n := len(f.bot.sent)
	if f.svc.SendPurchaseEvent(ctx, domain.RulePurchasePaid, p) || len(f.bot.sent) != n {
		t.Error("sent to a blocked user")
	}
	// A user without Telegram: nothing.
	if f.svc.SendPurchaseEvent(ctx, domain.RulePurchasePaid, domain.PurchaseRequest{UserID: uuid.New()}) {
		t.Error("sent to a user without Telegram")
	}
}
