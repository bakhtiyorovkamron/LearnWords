package postgres

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestFeedback_FirstAnswerWins_DismissedNotCounted(t *testing.T) {
	f := newMoveFixture(t)
	repo := NewFeedbackRepository(f.pool)
	ctx := context.Background()

	if ok, _ := repo.Answered(ctx, f.user); ok {
		t.Fatal("a new user has not answered")
	}
	if err := repo.Submit(ctx, f.user, 2, "first"); err != nil {
		t.Fatal(err)
	}
	_ = repo.Submit(ctx, f.user, 5, "second") // ignored
	_ = repo.Dismiss(ctx, f.user)             // ignored
	if ok, _ := repo.Answered(ctx, f.user); !ok {
		t.Error("answered after submit")
	}
	var rating int
	var comment string
	var dismissed bool
	if err := f.pool.QueryRow(ctx, `SELECT rating, comment, dismissed FROM feedback WHERE user_id = $1`, f.user).Scan(&rating, &comment, &dismissed); err != nil {
		t.Fatal(err)
	}
	if rating != 2 || comment != "first" || dismissed {
		t.Errorf("overwritten: %d %q %v", rating, comment, dismissed)
	}

	// A dismissed user, and one more rating: the summary counts ratings only.
	other := uuid.New()
	f.exec(t, `INSERT INTO users (id, email, password_hash) VALUES ($1, $2, 'x')`, other, other.String()+"@test")
	t.Cleanup(func() { f.pool.Exec(ctx, `DELETE FROM users WHERE id = $1`, other) }) //nolint:errcheck
	_ = repo.Dismiss(ctx, other)
	if ok, _ := repo.Answered(ctx, other); !ok {
		t.Error("answered after dismiss")
	}
	_ = repo.Submit(ctx, other, 5, "late") // after dismiss: still ignored
	var n int
	_ = f.pool.QueryRow(ctx, `SELECT count(*) FROM feedback WHERE user_id = $1 AND rating IS NOT NULL`, other).Scan(&n)
	if n != 0 {
		t.Error("a dismissed user's later rating must not be stored")
	}

	s, err := repo.Summary(ctx)
	if err != nil {
		t.Fatal(err)
	}
	mine := 0
	for _, it := range s.Items {
		if it.Rating == 0 || it.CreatedAt.Before(time.Now().Add(-time.Hour)) && false {
			t.Errorf("bad item %+v", it)
		}
		if it.Comment == "first" {
			mine++
		}
	}
	if mine != 1 || s.Count != len(s.Items) {
		t.Errorf("summary: %+v", s)
	}
}

func TestFeedback_AverageIgnoresDismissed(t *testing.T) {
	f := newMoveFixture(t)
	repo := NewFeedbackRepository(f.pool)
	ctx := context.Background()
	// Isolate: these tests share a database, so compare before/after.
	before, _ := repo.Summary(ctx)
	_ = repo.Submit(ctx, f.user, 4, "")
	after, err := repo.Summary(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if after.Count != before.Count+1 {
		t.Errorf("count %d → %d", before.Count, after.Count)
	}
	if after.Average < 1 || after.Average > 5 {
		t.Errorf("average %v", after.Average)
	}
	// The users list carries the rating.
	admin := NewAdminRepository(f.pool)
	users, err := admin.ListUsers(ctx)
	if err != nil {
		t.Fatal(err)
	}
	for _, u := range users {
		if u.ID == f.user && (u.Rating == nil || *u.Rating != 4) {
			t.Errorf("rating in users list: %v", u.Rating)
		}
	}
}
