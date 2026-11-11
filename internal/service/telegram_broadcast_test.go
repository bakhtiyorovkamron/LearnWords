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

// memBroadcasts is the postgres repository's behaviour in memory (the recipients are given).
type memBroadcasts struct {
	mu      sync.Mutex
	bs      map[int64]*domain.TelegramBroadcast
	recs    map[int64][]*memRecipient
	next    int64
	blocked map[uuid.UUID]bool
	auto    []string // "<kind> <user>" of every automatic message sent
}

type memRecipient struct {
	domain.BroadcastRecipient
	status string
}

func newMemBroadcasts() *memBroadcasts {
	return &memBroadcasts{bs: map[int64]*domain.TelegramBroadcast{}, recs: map[int64][]*memRecipient{}, blocked: map[uuid.UUID]bool{}}
}

// queue stores a broadcast with the given recipients.
func (m *memBroadcasts) queue(text domain.BroadcastText, button *domain.TelegramButton, rs ...domain.BroadcastRecipient) int64 {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.next++
	m.bs[m.next] = &domain.TelegramBroadcast{ID: m.next, Kind: "manual", Target: domain.BroadcastTargetAll, Text: text, Button: button,
		Status: domain.BroadcastQueued, Total: len(rs)}
	for _, r := range rs {
		m.recs[m.next] = append(m.recs[m.next], &memRecipient{BroadcastRecipient: r, status: domain.RecipientPending})
	}
	return m.next
}

func (m *memBroadcasts) Audience(context.Context) (domain.TelegramAudience, error) {
	return domain.TelegramAudience{}, nil
}

func (m *memBroadcasts) CreateBroadcast(_ context.Context, p domain.BroadcastParams) (domain.TelegramBroadcast, int, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.next++
	b := &domain.TelegramBroadcast{ID: m.next, Kind: "manual", Target: p.Target, Text: p.Text, Button: p.Button, Status: domain.BroadcastQueued}
	m.bs[b.ID] = b
	return *b, 0, nil
}

func (m *memBroadcasts) ClaimNext(context.Context) (*domain.TelegramBroadcast, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for id := int64(1); id <= m.next; id++ {
		if b := m.bs[id]; b != nil && b.Status == domain.BroadcastQueued {
			b.Status = domain.BroadcastRunning
			c := *b
			return &c, nil
		}
	}
	return nil, nil
}

func (m *memBroadcasts) PendingRecipients(_ context.Context, id int64, _ string, limit int) ([]domain.BroadcastRecipient, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []domain.BroadcastRecipient
	for _, r := range m.recs[id] {
		if r.status == domain.RecipientPending && len(out) < limit {
			out = append(out, r.BroadcastRecipient)
		}
	}
	return out, nil
}

func (m *memBroadcasts) SetRecipient(_ context.Context, id int64, user uuid.UUID, status string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, r := range m.recs[id] {
		if r.UserID == user {
			r.status = status
		}
	}
	return nil
}

func (m *memBroadcasts) MarkUserBlocked(_ context.Context, user uuid.UUID) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.blocked[user] = true
	return nil
}

func (m *memBroadcasts) RefreshCounters(_ context.Context, id int64) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	b := m.bs[id]
	b.Sent, b.Failed, b.Blocked = 0, 0, 0
	for _, r := range m.recs[id] {
		switch r.status {
		case domain.RecipientSent:
			b.Sent++
		case domain.RecipientFailed:
			b.Failed++
		case domain.RecipientBlocked:
			b.Blocked++
		}
	}
	return nil
}

func (m *memBroadcasts) Finish(_ context.Context, id int64, status string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.bs[id].Status = status
	return nil
}

func (m *memBroadcasts) InterruptUnfinished(context.Context) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, b := range m.bs {
		if b.Status == domain.BroadcastQueued || b.Status == domain.BroadcastRunning {
			b.Status = domain.BroadcastInterrupted
		}
	}
	return nil
}

func (m *memBroadcasts) MarkAutoSent(_ context.Context, kind string, user uuid.UUID) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.auto = append(m.auto, kind+" "+user.String())
	return nil
}

func (m *memBroadcasts) List(context.Context, int) ([]domain.TelegramBroadcast, error) {
	return nil, nil
}
func (m *memBroadcasts) Get(_ context.Context, id int64) (domain.TelegramBroadcast, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if b := m.bs[id]; b != nil {
		return *b, nil
	}
	return domain.TelegramBroadcast{}, domain.ErrNotFound
}

func (m *memBroadcasts) snapshot(id int64) domain.TelegramBroadcast {
	b, _ := m.Get(context.Background(), id)
	return b
}

func (m *memBroadcasts) statusOf(id int64, user uuid.UUID) string {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, r := range m.recs[id] {
		if r.UserID == user {
			return r.status
		}
	}
	return ""
}

func rec(chat int64, lang string) domain.BroadcastRecipient {
	return domain.BroadcastRecipient{UserID: uuid.New(), ChatID: &chat, Lang: lang, Reachable: true}
}

type broadcastFixture struct {
	svc   *TelegramBroadcastService
	repo  *memBroadcasts
	bot   *fakeBot
	sleep []time.Duration
}

func newBroadcastFixture() *broadcastFixture {
	f := &broadcastFixture{repo: newMemBroadcasts(), bot: &fakeBot{}}
	f.svc = NewTelegramBroadcastService(f.repo, f.bot, true)
	f.svc.pace = 0
	f.svc.sleep = func(ctx context.Context, d time.Duration) bool {
		if d > 0 {
			f.sleep = append(f.sleep, d)
		}
		return ctx.Err() == nil
	}
	return f
}

// run sends one queued broadcast to the end.
func (f *broadcastFixture) run(t *testing.T, id int64) domain.TelegramBroadcast {
	t.Helper()
	b, err := f.repo.ClaimNext(context.Background())
	if err != nil || b == nil || b.ID != id {
		t.Fatalf("claim: %+v %v", b, err)
	}
	f.svc.send(context.Background(), *b)
	return f.repo.snapshot(id)
}

func TestBroadcast_EachRecipientGetsTheirLanguage_FallbackIsRussian(t *testing.T) {
	f := newBroadcastFixture()
	text := domain.BroadcastText{RU: "Привет", UZ: strp("Salom"), EN: nil}
	ru, uz, en, other := rec(1, "ru"), rec(2, "uz"), rec(3, "en"), rec(4, "xx")
	id := f.repo.queue(text, &domain.TelegramButton{Text: "Open", URL: "https://yodla.fun"}, ru, uz, en, other)
	b := f.run(t, id)
	got := map[int64]string{}
	for _, m := range f.bot.sent {
		got[m.chat] = m.text
		if m.button == nil || m.button.URL != "https://yodla.fun" {
			t.Errorf("chat %d: button %+v", m.chat, m.button)
		}
	}
	if got[1] != "Привет" || got[2] != "Salom" || got[3] != "Привет" || got[4] != "Привет" {
		t.Errorf("texts %v (English has no translation: Russian; an unknown language: Russian)", got)
	}
	if b.Status != domain.BroadcastDone || b.Sent != 4 || b.Failed != 0 || b.Blocked != 0 {
		t.Errorf("broadcast %+v", b)
	}
}

func TestBroadcast_403CountsAsBlockedAndMarksTheUser(t *testing.T) {
	f := newBroadcastFixture()
	f.bot.err = domain.ErrBotBlocked
	r := rec(1, "ru")
	id := f.repo.queue(domain.BroadcastText{RU: "x"}, nil, r)
	b := f.run(t, id)
	if b.Blocked != 1 || b.Sent != 0 || !f.repo.blocked[r.UserID] || f.repo.statusOf(id, r.UserID) != domain.RecipientBlocked {
		t.Errorf("%+v blocked=%v", b, f.repo.blocked)
	}
}

func TestBroadcast_OtherErrorsAreFailed_NoChatOrNotReachableAnymoreToo(t *testing.T) {
	f := newBroadcastFixture()
	f.bot.err = errors.New("boom")
	gone := domain.BroadcastRecipient{UserID: uuid.New(), Reachable: false}
	id := f.repo.queue(domain.BroadcastText{RU: "x"}, nil, rec(1, "ru"), gone)
	b := f.run(t, id)
	if b.Failed != 2 || b.Sent != 0 {
		t.Errorf("%+v", b)
	}
	if len(f.bot.sent) != 0 {
		t.Error("sent to someone who cannot get it")
	}
}

type flakyBot struct {
	fakeBot
	failures []error // answers of the first sends
	calls    int
}

func (b *flakyBot) SendMessage(ctx context.Context, chat int64, text string, btn *domain.TelegramButton) error {
	b.mu.Lock()
	n := b.calls
	b.calls++
	b.mu.Unlock()
	if n < len(b.failures) && b.failures[n] != nil {
		return b.failures[n]
	}
	return b.fakeBot.SendMessage(ctx, chat, text, btn)
}

func TestBroadcast_429WaitsAndRetriesOnce(t *testing.T) {
	f := newBroadcastFixture()
	bot := &flakyBot{failures: []error{&domain.RetryAfterError{Seconds: 3}}}
	f.svc.bot = bot
	id := f.repo.queue(domain.BroadcastText{RU: "x"}, nil, rec(1, "ru"))
	b := f.run(t, id)
	if b.Sent != 1 || bot.calls != 2 || len(f.sleep) != 1 || f.sleep[0] != 3*time.Second {
		t.Errorf("%+v calls=%d sleeps=%v", b, bot.calls, f.sleep)
	}

	// A second 429 in a row: the recipient fails, no third try.
	f2 := newBroadcastFixture()
	bot2 := &flakyBot{failures: []error{&domain.RetryAfterError{Seconds: 1}, &domain.RetryAfterError{Seconds: 1}}}
	f2.svc.bot = bot2
	id2 := f2.repo.queue(domain.BroadcastText{RU: "x"}, nil, rec(1, "ru"))
	if b := f2.run(t, id2); b.Failed != 1 || bot2.calls != 2 {
		t.Errorf("%+v calls=%d", b, bot2.calls)
	}
}

// An interruption in the middle: what was sent stays sent, the rest is never sent twice later.
func TestBroadcast_NobodyGetsItTwiceAfterAnInterruption(t *testing.T) {
	f := newBroadcastFixture()
	rs := []domain.BroadcastRecipient{rec(1, "ru"), rec(2, "ru"), rec(3, "ru"), rec(4, "ru")}
	id := f.repo.queue(domain.BroadcastText{RU: "x"}, nil, rs...)
	ctx, cancel := context.WithCancel(context.Background())
	sends := 0
	f.svc.sleep = func(ctx context.Context, _ time.Duration) bool {
		if sends++; sends == 2 {
			cancel() // the shutdown comes after the second message
		}
		return ctx.Err() == nil
	}
	b, _ := f.repo.ClaimNext(ctx)
	f.svc.send(ctx, *b)
	if got := f.repo.snapshot(id); got.Status != domain.BroadcastInterrupted || got.Sent != 2 {
		t.Fatalf("after the interruption: %+v", got)
	}

	// The restart: still-unfinished ones are interrupted and nothing is resumed.
	f.svc.sleep = func(ctx context.Context, _ time.Duration) bool { return true }
	run, stop := context.WithCancel(context.Background())
	if err := f.svc.Start(run); err != nil {
		t.Fatal(err)
	}
	time.Sleep(50 * time.Millisecond)
	stop()
	f.svc.Wait()
	chats := map[int64]int{}
	for _, m := range f.bot.sent {
		chats[m.chat]++
	}
	if len(f.bot.sent) != 2 || chats[1] != 1 || chats[2] != 1 {
		t.Errorf("sent %v: two messages in all, one each to the first two", f.bot.sent)
	}
	if f.repo.snapshot(id).Status != domain.BroadcastInterrupted {
		t.Error("an interrupted broadcast was resumed")
	}
	// Even if one were claimed again by mistake, only 'pending' recipients are sent.
	f.repo.mu.Lock()
	f.repo.bs[id].Status = domain.BroadcastQueued
	f.repo.mu.Unlock()
	f.run(t, id)
	chats = map[int64]int{}
	for _, m := range f.bot.sent {
		chats[m.chat]++
	}
	for chat, n := range chats {
		if n != 1 {
			t.Errorf("chat %d got it %d times", chat, n)
		}
	}
}

func TestBroadcast_StartInterruptsWhatARestartCutOff(t *testing.T) {
	f := newBroadcastFixture()
	id := f.repo.queue(domain.BroadcastText{RU: "x"}, nil, rec(1, "ru"))
	f.repo.bs[id].Status = domain.BroadcastRunning
	ctx, stop := context.WithCancel(context.Background())
	if err := f.svc.Start(ctx); err != nil {
		t.Fatal(err)
	}
	stop()
	f.svc.Wait()
	if f.repo.snapshot(id).Status != domain.BroadcastInterrupted || len(f.bot.sent) != 0 {
		t.Errorf("%+v sent=%v", f.repo.snapshot(id), f.bot.sent)
	}
}

func TestBroadcast_WorkerSendsWhatCreateQueued(t *testing.T) {
	f := newBroadcastFixture()
	ctx, stop := context.WithCancel(context.Background())
	if err := f.svc.Start(ctx); err != nil {
		t.Fatal(err)
	}
	b, _, err := f.svc.Create(ctx, uuid.New(), domain.BroadcastTargetAll, nil, "Привет", "", "", nil)
	if err != nil {
		t.Fatal(err)
	}
	f.repo.mu.Lock()
	f.repo.recs[b.ID] = []*memRecipient{{BroadcastRecipient: rec(9, "ru"), status: domain.RecipientPending}}
	f.repo.mu.Unlock()
	f.svc.wake <- struct{}{}
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) && f.repo.snapshot(b.ID).Status != domain.BroadcastDone {
		time.Sleep(10 * time.Millisecond)
	}
	stop()
	f.svc.Wait()
	if got := f.repo.snapshot(b.ID); got.Status != domain.BroadcastDone || got.Sent != 1 {
		t.Errorf("%+v", got)
	}
}

func TestBroadcast_Validation(t *testing.T) {
	f := newBroadcastFixture()
	ctx, admin := context.Background(), uuid.New()
	long := strings.Repeat("я", 1001)
	btn := func(text, url string) *domain.TelegramButton { return &domain.TelegramButton{Text: text, URL: url} }
	for name, c := range map[string]struct {
		target     string
		ids        []uuid.UUID
		ru, uz, en string
		button     *domain.TelegramButton
	}{
		"no text":            {target: "all", ru: "   "},
		"text too long":      {target: "all", ru: long},
		"uz too long":        {target: "all", ru: "x", uz: long},
		"en too long":        {target: "all", ru: "x", en: long},
		"button text only":   {target: "all", ru: "x", button: btn("Open", "")},
		"button url only":    {target: "all", ru: "x", button: btn("", "https://yodla.fun")},
		"button label long":  {target: "all", ru: "x", button: btn(strings.Repeat("a", 41), "https://yodla.fun")},
		"button http":        {target: "all", ru: "x", button: btn("Open", "http://yodla.fun")},
		"button not a url":   {target: "all", ru: "x", button: btn("Open", "https://")},
		"button javascript":  {target: "all", ru: "x", button: btn("Open", "javascript:alert(1)")},
		"unknown target":     {target: "everyone", ru: "x"},
		"users without ids":  {target: "users", ru: "x"},
		"users too many ids": {target: "users", ru: "x", ids: manyIDs(201)},
	} {
		_, _, err := f.svc.Create(ctx, admin, c.target, c.ids, c.ru, c.uz, c.en, c.button)
		if !errors.Is(err, domain.ErrValidation) {
			t.Errorf("%s: %v, want a validation error", name, err)
		}
	}
	// Valid: 1000 characters, both fields of the button, 200 ids (duplicates counted once).
	if _, _, err := f.svc.Create(ctx, admin, "all", nil, strings.Repeat("я", 1000), "", "", btn(strings.Repeat("a", 40), "https://yodla.fun")); err != nil {
		t.Errorf("a valid broadcast: %v", err)
	}
	ids := manyIDs(200)
	if _, _, err := f.svc.Create(ctx, admin, "users", append(ids, ids[0]), "x", "", "", nil); err != nil {
		t.Errorf("200 ids with a duplicate: %v", err)
	}
	// Surrounding spaces are trimmed; empty translations are none.
	b, _, _ := f.svc.Create(ctx, admin, "all", nil, "  hi  ", "  ", "", nil)
	if b.Text.RU != "hi" || b.Text.UZ != nil || b.Text.EN != nil {
		t.Errorf("text %+v", b.Text)
	}
	// No bot: unavailable.
	off := NewTelegramBroadcastService(f.repo, nil, false)
	if _, _, err := off.Create(ctx, admin, "all", nil, "x", "", "", nil); !errors.Is(err, domain.ErrTelegramUnavailable) {
		t.Errorf("no bot: %v", err)
	}
	if _, err := off.Audience(ctx); !errors.Is(err, domain.ErrTelegramUnavailable) {
		t.Errorf("audience without a bot: %v", err)
	}
}

func manyIDs(n int) []uuid.UUID {
	out := make([]uuid.UUID, n)
	for i := range out {
		out[i] = uuid.New()
	}
	return out
}
