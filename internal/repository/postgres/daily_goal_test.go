package postgres

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"

	"learnwords/internal/domain"
	"learnwords/internal/service"
	"learnwords/migrations"
)

type goalFixture struct {
	moveFixture
	review *service.ReviewService
	repo   *ReviewRepository
	users  *UserRepository
}

func newGoalFixture(t *testing.T) goalFixture {
	f := newMoveFixture(t)
	repo := NewReviewRepository(f.pool)
	return goalFixture{f, service.NewReviewService(repo), repo, NewUserRepository(f.pool)}
}

// words adds n unreviewed (= due) cards and returns their ids.
func (f goalFixture) words(t *testing.T, n int) []uuid.UUID {
	var ids []uuid.UUID
	for i := 0; i < n; i++ {
		ctxID, id := uuid.New(), uuid.New()
		f.exec(t, `INSERT INTO contexts (id, user_id, source_text) VALUES ($1, $2, $3)`, ctxID, f.user, id.String())
		f.exec(t, `INSERT INTO word_cards (id, context_id, user_id, word, translation) VALUES ($1, $2, $3, $4, 'x')`, id, ctxID, f.user, id.String())
		ids = append(ids, id)
	}
	return ids
}

func (f goalFixture) answer(t *testing.T, id uuid.UUID, correct bool) {
	t.Helper()
	if _, err := f.review.Answer(context.Background(), f.user, id, correct); err != nil {
		t.Fatal(err)
	}
}

func (f goalFixture) goalDays(t *testing.T) int {
	return f.count(t, `SELECT count(*) FROM goal_days WHERE user_id = $1`, f.user)
}

func TestDailyGoal_DefaultAndOnlyTheAllowedValues(t *testing.T) {
	f := newGoalFixture(t)
	ctx := context.Background()
	if g, err := f.users.DailyGoal(ctx, f.user); err != nil || g != 20 {
		t.Fatalf("default: %d %v", g, err)
	}
	for _, g := range []int{10, 30, 50, 20} {
		if err := f.users.SetDailyGoal(ctx, f.user, g); err != nil {
			t.Fatal(err)
		}
		if got, _ := f.users.DailyGoal(ctx, f.user); got != g {
			t.Errorf("stored %d, read %d", g, got)
		}
	}
	if err := f.users.SetDailyGoal(ctx, f.user, 15); err == nil {
		t.Error("15 must be refused by the CHECK constraint")
	}
	if err := f.users.SetDailyGoal(ctx, uuid.New(), 10); err != domain.ErrNotFound {
		t.Errorf("unknown user: %v", err)
	}
}

// The goal is reached at min(goal, answered + still due): exactly there the day is recorded, once.
func TestGoalDays_ReachedGoalIsRecordedOnce(t *testing.T) {
	f := newGoalFixture(t)
	if err := f.users.SetDailyGoal(context.Background(), f.user, 10); err != nil {
		t.Fatal(err)
	}
	ids := f.words(t, 12)
	for i := 0; i < 9; i++ {
		f.answer(t, ids[i], true)
	}
	if n := f.goalDays(t); n != 0 {
		t.Fatalf("after 9 of a goal of 10: %d goal days", n)
	}
	f.answer(t, ids[9], false) // a wrong answer counts as reviewed, too
	if n := f.goalDays(t); n != 1 {
		t.Fatalf("after the 10th answer: %d goal days, want 1", n)
	}
	f.answer(t, ids[10], true)
	f.answer(t, ids[11], true)
	if n := f.goalDays(t); n != 1 {
		t.Errorf("more answers: %d goal days, want still 1", n)
	}
}

// With fewer due words than the goal, answering all of them reaches it.
func TestGoalDays_ASmallQueueCanReachTheGoal(t *testing.T) {
	f := newGoalFixture(t)
	ids := f.words(t, 3) // goal 20 (default)
	f.answer(t, ids[0], true)
	f.answer(t, ids[1], true)
	if n := f.goalDays(t); n != 0 {
		t.Fatalf("2 of 3: %d", n)
	}
	f.answer(t, ids[2], true)
	if n := f.goalDays(t); n != 1 {
		t.Errorf("all 3 answered: %d goal days, want 1", n)
	}
}

func TestGoalDays_PracticeAndNothingDueNeverRecord(t *testing.T) {
	f := newGoalFixture(t)
	ctx := context.Background()
	ids := f.words(t, 2)
	for i := 0; i < 30; i++ {
		if err := f.review.AnswerPractice(ctx, f.user, ids[0], true); err != nil {
			t.Fatal(err)
		}
	}
	if n := f.goalDays(t); n != 0 {
		t.Errorf("practice answers recorded a goal day: %d", n)
	}
	// An explicit check with nothing answered by review and nothing due is no goal either.
	empty := newGoalFixture(t)
	if err := empty.repo.MarkGoalDay(ctx, empty.user, time.Now().UTC()); err != nil {
		t.Fatal(err)
	}
	if n := empty.goalDays(t); n != 0 {
		t.Errorf("nothing at all: %d", n)
	}
}

func TestStats_DaysCarryActiveAndGoalMet(t *testing.T) {
	f := newGoalFixture(t)
	ctx := context.Background()
	ids := f.words(t, 1)
	today := time.Now().UTC().Truncate(24 * time.Hour)
	d1, d2, d3 := today.AddDate(0, 0, -3), today.AddDate(0, 0, -2), today.AddDate(0, 0, -1)
	// d1: practice only (active, goal not met); d2: nothing; d3: a goal day with a review answer.
	f.exec(t, `INSERT INTO review_logs (user_id, word_id, is_correct, session_type, reviewed_at) VALUES ($1, $2, true, 'practice', $3)`, f.user, ids[0], d1.Add(10*time.Hour))
	f.exec(t, `INSERT INTO review_logs (user_id, word_id, is_correct, session_type, reviewed_at) VALUES ($1, $2, true, 'review', $3)`, f.user, ids[0], d3.Add(10*time.Hour))
	f.exec(t, `INSERT INTO goal_days (user_id, day) VALUES ($1, $2::date)`, f.user, d3)

	days, err := NewStatsRepository(f.pool).Daily(ctx, f.user, d1, today)
	if err != nil {
		t.Fatal(err)
	}
	type flags struct{ active, met bool }
	got := map[string]flags{}
	for _, d := range days {
		got[d.Date] = flags{d.Active, d.GoalMet}
	}
	want := map[string]flags{
		d1.Format("2006-01-02"):    {true, false},
		d2.Format("2006-01-02"):    {false, false},
		d3.Format("2006-01-02"):    {true, true},
		today.Format("2006-01-02"): {false, false},
	}
	for date, w := range want {
		if got[date] != w {
			t.Errorf("%s: %+v, want %+v", date, got[date], w)
		}
	}
	// "reviewed" is still the review answers only
	for _, d := range days {
		if d.Date == d1.Format("2006-01-02") && d.Reviewed != 0 {
			t.Errorf("a practice answer counted as reviewed: %+v", d)
		}
	}
}

func TestMigration40_UpAndDown(t *testing.T) {
	f := newGoalFixture(t)
	read := func(name string) string {
		b, err := migrations.FS.ReadFile(name)
		if err != nil {
			t.Fatal(err)
		}
		return string(b)
	}
	f.exec(t, read("000040_daily_goal.up.sql")) // idempotent on an already migrated database
	if g, _ := f.users.DailyGoal(context.Background(), f.user); g != 20 {
		t.Errorf("default goal %d", g)
	}
	f.exec(t, read("000040_daily_goal.down.sql"))
	if n := f.count(t, `SELECT count(*) FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'daily_goal'`); n != 0 {
		t.Error("down left the column")
	}
	if n := f.count(t, `SELECT count(*) FROM information_schema.tables WHERE table_name = 'goal_days'`); n != 0 {
		t.Error("down left the table")
	}
	f.exec(t, read("000040_daily_goal.up.sql"))
	if n := f.count(t, `SELECT count(*) FROM information_schema.tables WHERE table_name = 'goal_days'`); n != 1 {
		t.Error("up did not recreate the table")
	}
}
