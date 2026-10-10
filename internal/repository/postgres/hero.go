package postgres

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// HeroRepository backs the "German hero" feature. All queries are scoped to German
// (word_cards.language = 'de') — the feature is German-only for now.
type HeroRepository struct{ pool *pgxpool.Pool }

func NewHeroRepository(pool *pgxpool.Pool) *HeroRepository { return &HeroRepository{pool: pool} }

// CountLearned returns how many German words are at box_level >= minBox.
func (r *HeroRepository) CountLearned(ctx context.Context, userID uuid.UUID, minBox int) (int, error) {
	var n int
	err := r.pool.QueryRow(ctx, `
		SELECT count(*)
		FROM word_progress p
		JOIN word_cards w ON w.id = p.word_id
		WHERE p.user_id = $1 AND p.box_level >= $2 AND w.language = 'de'`,
		userID, minBox).Scan(&n)
	return n, err
}

// LearnedWords returns the spelling of every learned German word (box_level >= minBox) —
// small enough (a few thousand short strings at most) to fetch whole and pick/filter in Go,
// which avoids any sampling bias from picking a random subset in SQL first.
func (r *HeroRepository) LearnedWords(ctx context.Context, userID uuid.UUID, minBox int) ([]string, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT w.word
		FROM word_progress p
		JOIN word_cards w ON w.id = p.word_id
		WHERE p.user_id = $1 AND p.box_level >= $2 AND w.language = 'de'`,
		userID, minBox)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowTo[string])
}

// HeroStage returns the highest stage ever recorded for userID; ok=false if never set.
func (r *HeroRepository) HeroStage(ctx context.Context, userID uuid.UUID) (stage int, ok bool, err error) {
	var s *int16
	err = r.pool.QueryRow(ctx, `SELECT hero_stage FROM users WHERE id = $1`, userID).Scan(&s)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, false, nil
	}
	if err != nil {
		return 0, false, err
	}
	if s == nil {
		return 0, false, nil
	}
	return int(*s), true, nil
}

// SetHeroStage records the highest stage reached so far.
func (r *HeroRepository) SetHeroStage(ctx context.Context, userID uuid.UUID, stage int) error {
	_, err := r.pool.Exec(ctx, `UPDATE users SET hero_stage = $2 WHERE id = $1`, userID, stage)
	return err
}
