package postgres

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	"learnwords/internal/domain"
	"learnwords/internal/service"
)

// ruleUser adds a linked, reachable user with an optional profile name.
func ruleUser(t *testing.T, f moveFixture, name string) uuid.UUID {
	t.Helper()
	u := tgUser(t, f, chatSeq(), true, false, false, "ru")
	if name != "" {
		f.exec(t, `UPDATE users SET full_name = $2 WHERE id = $1`, u, name)
	}
	return u
}

// wordOf adds a card for the user: due today (or not), created at `created`.
func wordOf(t *testing.T, f moveFixture, u uuid.UUID, due bool, created time.Time, paused bool) {
	t.Helper()
	ctxID, id := uuid.New(), uuid.New()
	f.exec(t, `INSERT INTO contexts (id, user_id, source_text) VALUES ($1, $2, $3)`, ctxID, u, id.String())
	f.exec(t, `INSERT INTO word_cards (id, context_id, user_id, word, translation, created_at, paused) VALUES ($1, $2, $3, $4, 'x', $5, $6)`,
		id, ctxID, u, id.String(), created, paused)
	next := time.Now().AddDate(0, 0, 10)
	if due {
		next = time.Now().AddDate(0, 0, -1)
	}
	f.exec(t, `INSERT INTO word_progress (word_id, user_id, box_level, next_review_at) VALUES ($1, $2, 2, $3)`, id, u, next)
}

func reviewedAt(t *testing.T, f moveFixture, u uuid.UUID, at time.Time) {
	t.Helper()
	var word uuid.UUID
	if err := f.pool.QueryRow(context.Background(), `SELECT id FROM word_cards WHERE user_id = $1 LIMIT 1`, u).Scan(&word); err != nil {
		t.Fatal(err)
	}
	f.exec(t, `INSERT INTO review_logs (user_id, word_id, is_correct, session_type, reviewed_at) VALUES ($1, $2, true, 'review', $3)`, u, word, at)
}

func ruleToday() service.RuleDay {
	now := time.Now().UTC()
	start := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
	return service.RuleDay{Today: start, Start: start, Now: now}
}

// runRule creates the rule's broadcast and returns who is in it (nil = nobody) among `mine`.
func runRule(t *testing.T, f moveFixture, repo *TelegramRulesRepository, key string, mine ...uuid.UUID) map[uuid.UUID]string {
	t.Helper()
	ctx := context.Background()
	rule, err := repo.Rule(ctx, key)
	if err != nil {
		t.Fatal(err)
	}
	b, err := repo.CreateRuleBroadcast(ctx, rule, ruleToday())
	if err != nil {
		t.Fatal(err)
	}
	out := map[uuid.UUID]string{}
	if b == nil {
		return out
	}
	t.Cleanup(func() { f.pool.Exec(ctx, `UPDATE telegram_broadcasts SET status = 'interrupted' WHERE id = $1`, b.ID) }) //nolint:errcheck
	if b.Kind != "auto:"+key || b.Target != "all" {
		t.Errorf("broadcast %+v", b)
	}
	for _, u := range mine {
		var params string
		var status string
		err := f.pool.QueryRow(ctx, `SELECT status, params::text FROM telegram_broadcast_recipients WHERE broadcast_id = $1 AND user_id = $2`, b.ID, u).Scan(&status, &params)
		if err == nil {
			out[u] = params
		}
	}
	return out
}

func TestRules_SeededOffWithTheDefaultTexts(t *testing.T) {
	f := newMoveFixture(t)
	repo, ctx := NewTelegramRulesRepository(f.pool), context.Background()
	rules, err := repo.Rules(ctx)
	if err != nil || len(rules) != 4 {
		t.Fatalf("%d rules: %v", len(rules), err)
	}
	for i, key := range []string{"review_reminder", "comeback", "purchase_paid", "purchase_rejected"} {
		if rules[i].Key != key {
			t.Errorf("rule %d is %s", i, rules[i].Key)
		}
		if rules[i].Text.RU == "" || rules[i].Text.UZ == nil || rules[i].Text.EN == nil {
			t.Errorf("%s: texts %+v", key, rules[i].Text)
		}
	}
	// The migration seeds them off; other tests may have switched one, so only the seeded rows are checked
	// when nothing has edited them: a fresh database is all off.
	if r := rules[0]; r.SendAt == nil || *r.SendAt != "19:00" && r.LastRunOn == nil && r.Enabled {
		t.Errorf("review_reminder %+v", r)
	}
	if rules[1].SendAt == nil || rules[2].SendAt != nil || rules[3].SendAt != nil {
		t.Errorf("send_at %v %v %v", rules[1].SendAt, rules[2].SendAt, rules[3].SendAt)
	}
	if rules[2].Placeholders[2] != "amount" || len(rules[0].Placeholders) != 2 {
		t.Errorf("placeholders %v %v", rules[0].Placeholders, rules[2].Placeholders)
	}
}

func TestRules_SaveAndRead(t *testing.T) {
	f := newMoveFixture(t)
	repo, ctx := NewTelegramRulesRepository(f.pool), context.Background()
	orig, _ := repo.Rule(ctx, "purchase_rejected")
	origComeback, _ := repo.Rule(ctx, "comeback")
	t.Cleanup(func() {
		repo.SaveRule(ctx, orig)         //nolint:errcheck
		repo.SaveRule(ctx, origComeback) //nolint:errcheck
	})
	saved, err := repo.SaveRule(ctx, domain.TelegramRule{Key: "purchase_rejected", Enabled: true,
		Text: domain.BroadcastText{RU: "Отклонено {code}", EN: strp("Declined {code}")}, Button: &domain.TelegramButton{Text: "Open", URL: "https://yodla.fun"}})
	if err != nil || !saved.Enabled || saved.Text.RU != "Отклонено {code}" || saved.Text.UZ != nil || saved.Button == nil || saved.SendAt != nil {
		t.Fatalf("%+v %v", saved, err)
	}
	if _, err := repo.SaveRule(ctx, domain.TelegramRule{Key: "nope", Text: domain.BroadcastText{RU: "x"}}); err == nil {
		t.Error("saved an unknown rule")
	}
	at := "08:30"
	if r, err := repo.SaveRule(ctx, domain.TelegramRule{Key: "comeback", SendAt: &at, Text: domain.BroadcastText{RU: "x"}}); err != nil || *r.SendAt != "08:30" {
		t.Errorf("send_at %+v %v", r, err)
	}
}

func TestRules_TheClaimIsOnePerDayEvenWithManyCallers(t *testing.T) {
	f := newMoveFixture(t)
	repo, ctx := NewTelegramRulesRepository(f.pool), context.Background()
	orig, _ := repo.Rule(ctx, "review_reminder")
	f.exec(t, `UPDATE telegram_rules SET enabled = true, last_run_on = NULL WHERE key = 'review_reminder'`)
	t.Cleanup(func() {
		f.pool.Exec(ctx, `UPDATE telegram_rules SET enabled = $1, last_run_on = NULL WHERE key = 'review_reminder'`, orig.Enabled) //nolint:errcheck
	})
	day := time.Date(2026, 11, 10, 0, 0, 0, 0, time.UTC)
	var (
		wg   sync.WaitGroup
		mu   sync.Mutex
		wins int
	)
	for i := 0; i < 12; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			ok, err := repo.ClaimRun(ctx, "review_reminder", day)
			if err != nil {
				t.Error(err)
			}
			if ok {
				mu.Lock()
				wins++
				mu.Unlock()
			}
		}()
	}
	wg.Wait()
	if wins != 1 {
		t.Fatalf("%d callers got the run, want 1", wins)
	}
	if ok, _ := repo.ClaimRun(ctx, "review_reminder", day); ok {
		t.Error("claimed twice on one day")
	}
	if r, _ := repo.Rule(ctx, "review_reminder"); r.LastRunOn == nil || *r.LastRunOn != "2026-11-10" {
		t.Errorf("last_run_on %v", r.LastRunOn)
	}
	if ok, _ := repo.ClaimRun(ctx, "review_reminder", day.AddDate(0, 0, 1)); !ok {
		t.Error("the next day cannot be claimed")
	}
	// A claim given back can be taken again.
	if err := repo.ReleaseRun(ctx, "review_reminder", day.AddDate(0, 0, 1)); err != nil {
		t.Fatal(err)
	}
	if ok, _ := repo.ClaimRun(ctx, "review_reminder", day.AddDate(0, 0, 1)); !ok {
		t.Error("a released claim was not available")
	}
	// A disabled rule is never claimed.
	f.exec(t, `UPDATE telegram_rules SET enabled = false, last_run_on = NULL WHERE key = 'review_reminder'`)
	if ok, _ := repo.ClaimRun(ctx, "review_reminder", day); ok {
		t.Error("claimed a disabled rule")
	}
}

func TestRules_ReviewReminderAudience(t *testing.T) {
	f := newMoveFixture(t)
	repo, ctx := NewTelegramRulesRepository(f.pool), context.Background()
	recent := time.Now().Add(-48 * time.Hour)

	included := ruleUser(t, f, "Anna")
	wordOf(t, f, included, true, recent, false)
	twoLeft := ruleUser(t, f, "")
	wordOf(t, f, twoLeft, true, recent, false)
	f.exec(t, `UPDATE users SET telegram_reminders_unanswered = 2 WHERE id = $1`, twoLeft)

	reviewedToday := ruleUser(t, f, "")
	wordOf(t, f, reviewedToday, true, recent, false)
	reviewedAt(t, f, reviewedToday, time.Now().Add(-time.Minute))
	reviewedYesterday := ruleUser(t, f, "") // yesterday does not count: the reminder is due again
	wordOf(t, f, reviewedYesterday, true, recent, false)
	reviewedAt(t, f, reviewedYesterday, time.Now().AddDate(0, 0, -1).Add(-2*time.Hour))

	nothingDue := ruleUser(t, f, "")
	wordOf(t, f, nothingDue, false, recent, false)
	onlyPaused := ruleUser(t, f, "")
	wordOf(t, f, onlyPaused, true, recent, true)
	absent := ruleUser(t, f, "") // last activity 10 days ago: a comeback case, not a reminder
	wordOf(t, f, absent, true, time.Now().AddDate(0, 0, -10), false)
	noWords := ruleUser(t, f, "")
	unanswered := ruleUser(t, f, "")
	wordOf(t, f, unanswered, true, recent, false)
	f.exec(t, `UPDATE users SET telegram_reminders_unanswered = 3 WHERE id = $1`, unanswered)

	optedOut := ruleUser(t, f, "")
	wordOf(t, f, optedOut, true, recent, false)
	f.exec(t, `UPDATE users SET telegram_notifications = false WHERE id = $1`, optedOut)
	blocked := ruleUser(t, f, "")
	wordOf(t, f, blocked, true, recent, false)
	f.exec(t, `UPDATE users SET telegram_blocked_at = now() WHERE id = $1`, blocked)
	banned := ruleUser(t, f, "")
	wordOf(t, f, banned, true, recent, false)
	f.exec(t, `UPDATE users SET is_banned = true WHERE id = $1`, banned)
	unlinked := addUser(t, f, "user", false)
	wordOf(t, f, unlinked, true, recent, false)

	before, err := repo.CountRuleAudience(ctx, "review_reminder", ruleToday())
	if err != nil {
		t.Fatal(err)
	}
	got := runRule(t, f, repo, "review_reminder", included, twoLeft, reviewedToday, reviewedYesterday, nothingDue, onlyPaused,
		absent, noWords, unanswered, optedOut, blocked, banned, unlinked)
	for _, u := range []uuid.UUID{included, twoLeft, reviewedYesterday} {
		if _, in := got[u]; !in {
			t.Errorf("user %v is missing", u)
		}
	}
	for name, u := range map[string]uuid.UUID{"reviewed today": reviewedToday, "nothing due": nothingDue, "only paused words": onlyPaused,
		"absent": absent, "no words": noWords, "3 unanswered": unanswered, "opted out": optedOut, "blocked": blocked, "banned": banned, "unlinked": unlinked} {
		if _, in := got[u]; in {
			t.Errorf("%s is in the audience", name)
		}
	}
	if len(got) != 3 || before < 3 {
		t.Errorf("recipients %d, preview %d", len(got), before)
	}
	if p := got[included]; p != `{"name": "Anna", "count": "1"}` {
		t.Errorf("params %s", p)
	}
	if p := got[twoLeft]; p != `{"name": "", "count": "1"}` {
		t.Errorf("params without a name %s", p)
	}
}

func TestRules_ComebackOncePerAbsence_NeverWithAReminder(t *testing.T) {
	f := newMoveFixture(t)
	repo := NewTelegramRulesRepository(f.pool)
	old := time.Now().AddDate(0, 0, -9)

	gone := ruleUser(t, f, "Bob")
	wordOf(t, f, gone, true, old, false)
	justOver := ruleUser(t, f, "")
	wordOf(t, f, justOver, true, time.Now().Add(-7*24*time.Hour-time.Minute), false)
	justUnder := ruleUser(t, f, "")
	wordOf(t, f, justUnder, true, time.Now().Add(-6*24*time.Hour), false)
	alreadySent := ruleUser(t, f, "")
	wordOf(t, f, alreadySent, true, old, false)
	f.exec(t, `UPDATE users SET telegram_comeback_sent_at = now() - interval '2 days' WHERE id = $1`, alreadySent) // after the last activity
	cameBackAndLeftAgain := ruleUser(t, f, "")
	wordOf(t, f, cameBackAndLeftAgain, true, old, false)
	f.exec(t, `UPDATE users SET telegram_comeback_sent_at = now() - interval '30 days' WHERE id = $1`, cameBackAndLeftAgain) // before it: a new absence
	neverActive := ruleUser(t, f, "")
	optedOut := ruleUser(t, f, "")
	wordOf(t, f, optedOut, true, old, false)
	f.exec(t, `UPDATE users SET telegram_notifications = false WHERE id = $1`, optedOut)
	nothingDue := ruleUser(t, f, "")
	wordOf(t, f, nothingDue, false, old, false)

	got := runRule(t, f, repo, "comeback", gone, justOver, justUnder, alreadySent, cameBackAndLeftAgain, neverActive, optedOut, nothingDue)
	for _, u := range []uuid.UUID{gone, justOver, cameBackAndLeftAgain} {
		if _, in := got[u]; !in {
			t.Errorf("user %v is missing", u)
		}
	}
	for name, u := range map[string]uuid.UUID{"7 days not yet": justUnder, "already sent for this absence": alreadySent, "never active": neverActive,
		"opted out": optedOut, "nothing due": nothingDue} {
		if _, in := got[u]; in {
			t.Errorf("%s is in the audience", name)
		}
	}

	// Never together with a reminder on the same day: whoever is already in today's broadcast is skipped.
	again := runRule(t, f, repo, "comeback", gone, justOver, cameBackAndLeftAgain)
	if len(again) != 0 {
		t.Errorf("a second run the same day reached %d users", len(again))
	}
	f.exec(t, `UPDATE telegram_broadcasts SET status = 'interrupted' WHERE kind = 'auto:comeback'`)
	reminderToo := ruleUser(t, f, "")
	wordOf(t, f, reminderToo, true, old, false)
	f.exec(t, `INSERT INTO telegram_broadcasts (kind, target, text_ru, status, total) VALUES ('auto:review_reminder', 'all', 'x', 'done', 1)`)
	f.exec(t, `INSERT INTO telegram_broadcast_recipients (broadcast_id, user_id, status)
		SELECT max(id), $1, 'sent' FROM telegram_broadcasts WHERE kind = 'auto:review_reminder'`, reminderToo)
	if _, in := runRule(t, f, repo, "comeback", reminderToo)[reminderToo]; in {
		t.Error("a user who got the review reminder today also got the comeback")
	}
}

func TestRules_AReviewResetsTheUnansweredCounter(t *testing.T) {
	f := newGoalFixture(t)
	u := f.user
	f.exec(t, `UPDATE users SET telegram_reminders_unanswered = 2 WHERE id = $1`, u)
	ids := f.words(t, 2)
	read := func() int {
		var n int
		if err := f.pool.QueryRow(context.Background(), `SELECT telegram_reminders_unanswered FROM users WHERE id = $1`, u).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	// Practice is not a review.
	if err := NewReviewRepository(f.pool).LogPractice(context.Background(), u, ids[0], true); err != nil {
		t.Fatal(err)
	}
	if n := read(); n != 2 {
		t.Errorf("practice reset the counter: %d", n)
	}
	f.answer(t, ids[1], true)
	if n := read(); n != 0 {
		t.Errorf("after a review: %d, want 0", n)
	}
}

func TestRules_Recipient_IgnoresTheSwitchButNotBlocked(t *testing.T) {
	f := newMoveFixture(t)
	repo, ctx := NewTelegramRulesRepository(f.pool), context.Background()
	u := ruleUser(t, f, "Eve")
	f.exec(t, `UPDATE users SET telegram_notifications = false, telegram_lang = 'uz' WHERE id = $1`, u)
	r, found, err := repo.Recipient(ctx, u)
	if err != nil || !found || r.Lang != "uz" || r.Name != "Eve" || r.ChatID == 0 {
		t.Fatalf("with notifications off: %+v %v %v", r, found, err)
	}
	if err := repo.MarkBlocked(ctx, u); err != nil {
		t.Fatal(err)
	}
	if _, found, _ := repo.Recipient(ctx, u); found {
		t.Error("a blocked user is a recipient")
	}
	if _, found, _ := repo.Recipient(ctx, addUser(t, f, "user", false)); found {
		t.Error("a user without Telegram is a recipient")
	}
}

// The whole thing with the real repositories: the scheduler queues the run, the worker renders each
// user's text, counts the reminder, and a second tick the same day does nothing.
func TestRules_SchedulerAndWorkerEndToEnd(t *testing.T) {
	f := newMoveFixture(t)
	rulesRepo, bcRepo, ctx := NewTelegramRulesRepository(f.pool), NewTelegramBroadcastRepository(f.pool), context.Background()
	f.exec(t, `UPDATE telegram_broadcasts SET status = 'interrupted' WHERE status IN ('queued', 'running')`)
	orig, _ := rulesRepo.Rule(ctx, "review_reminder")
	t.Cleanup(func() {
		rulesRepo.SaveRule(ctx, orig)                                                                  //nolint:errcheck
		f.pool.Exec(ctx, `UPDATE telegram_rules SET last_run_on = NULL WHERE key = 'review_reminder'`) //nolint:errcheck
	})

	// Other users of a shared database may be in the run too: only this test's users are checked.
	base := chatSeq() + 5000
	recent := time.Now().Add(-24 * time.Hour)
	a := tgUser(t, f, base+1, true, false, false, "uz")
	b := tgUser(t, f, base+2, true, false, false, "")
	f.exec(t, `UPDATE users SET full_name = 'Anna' WHERE id = $1`, a)
	wordOf(t, f, a, true, recent, false)
	wordOf(t, f, a, true, recent, false)
	wordOf(t, f, b, true, recent, false)

	bot := &endBot{}
	bsvc := service.NewTelegramBroadcastService(bcRepo, bot, true)
	run, stop := context.WithCancel(ctx)
	defer stop()
	if err := bsvc.Start(run); err != nil {
		t.Fatal(err)
	}
	loc := time.UTC
	svc := service.NewTelegramRulesService(rulesRepo, bot, true, loc, bsvc.Wake)
	if _, err := svc.Update(ctx, "review_reminder", true, strp("00:00"), "{name}, слов: {count}", "{name}: so‘zlar {count}", "", &domain.TelegramButton{Text: "Open", URL: "https://yodla.fun"}); err == nil {
		t.Fatal("00:00 was accepted: quiet hours")
	}
	now := time.Now().UTC()
	at := now.Add(-time.Minute).Format("15:04")
	h := now.Hour()
	if h < 8 || h >= 21 { // the tests run at any hour: the scheduler clock is the test's, in a safe window
		now = time.Date(now.Year(), now.Month(), now.Day(), 12, 5, 0, 0, time.UTC)
		at = "12:00"
	}
	if _, err := svc.Update(ctx, "review_reminder", true, &at, "{name}, слов: {count}", "{name}: so‘zlar {count}", "", &domain.TelegramButton{Text: "Open", URL: "https://yodla.fun"}); err != nil {
		t.Fatal(err)
	}
	svc.Tick(ctx, now)

	var done *domain.TelegramBroadcast
	for deadline := time.Now().Add(10 * time.Second); time.Now().Before(deadline); time.Sleep(50 * time.Millisecond) {
		list, _ := bcRepo.List(ctx, 1)
		if len(list) == 1 && list[0].Kind == "auto:review_reminder" && list[0].Status == domain.BroadcastDone {
			done = &list[0]
			break
		}
	}
	stop()
	bsvc.Wait()
	if done == nil || done.Sent < 2 || done.Total < 2 {
		t.Fatalf("the run: %+v", done)
	}
	if bot.texts[base+1] != "Anna: so‘zlar 2" || bot.texts[base+2] != "слов: 1" || bot.buttons < 2 {
		t.Errorf("texts %v buttons %d", bot.texts, bot.buttons)
	}
	var n int
	if err := f.pool.QueryRow(ctx, `SELECT telegram_reminders_unanswered FROM users WHERE id = $1`, a).Scan(&n); err != nil || n != 1 {
		t.Errorf("unanswered %d (%v), want 1", n, err)
	}
	// The same day again: nothing new.
	svc.Tick(ctx, now.Add(time.Minute))
	if list, _ := bcRepo.List(ctx, 2); len(list) > 0 && list[0].ID != done.ID {
		t.Errorf("a second run the same day: %+v", list[0])
	}
	if r, _ := rulesRepo.Rule(ctx, "review_reminder"); r.LastSent == nil || *r.LastSent < 2 || r.LastRunOn == nil {
		t.Errorf("last run: %+v", r)
	}
}
