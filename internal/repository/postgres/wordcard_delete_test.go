package postgres

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestDeleteWords_OwnWordsOnlyAndIdempotent(t *testing.T) {
	f := newMoveFixture(t)
	other := newMoveFixture(t)
	repo, ctx := NewWordCardRepository(f.pool), context.Background()
	a1 := f.word(t, f.user, nil, time.Now())
	a2 := f.word(t, f.user, nil, time.Now())
	a3 := f.word(t, f.user, nil, time.Now())
	b1 := f.word(t, other.user, nil, time.Now())
	f.exec(t, `INSERT INTO review_logs (user_id, word_id, is_correct) VALUES ($1, $2, true)`, f.user, a1)

	n, err := repo.DeleteWords(ctx, f.user, []uuid.UUID{a1, a2, b1, uuid.New()})
	if err != nil || n != 2 {
		t.Fatalf("delete: n=%d err=%v, want 2", n, err)
	}
	if f.count(t, `SELECT count(*) FROM word_cards WHERE id IN ($1, $2)`, a1, a2) != 0 {
		t.Error("a1 or a2 still exists")
	}
	if f.count(t, `SELECT count(*) FROM word_progress WHERE word_id IN ($1, $2)`, a1, a2) != 0 {
		t.Error("progress of a1 or a2 still exists")
	}
	if f.count(t, `SELECT count(*) FROM word_cards WHERE id IN ($1, $2)`, a3, b1) != 2 {
		t.Error("a3 or b1 was deleted")
	}
	if f.count(t, `SELECT count(*) FROM review_logs WHERE user_id = $1 AND word_id IS NULL`, f.user) != 1 {
		t.Error("review log of a1 did not keep its row with word_id NULL")
	}

	if n, err := repo.DeleteWords(ctx, f.user, []uuid.UUID{a1, a2}); err != nil || n != 0 {
		t.Errorf("retry: n=%d err=%v, want 0 and no error", n, err)
	}
}
