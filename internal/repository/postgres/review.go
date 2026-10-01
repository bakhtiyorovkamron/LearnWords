package postgres

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"learnwords/internal/domain"
)

type ReviewRepository struct{ pool *pgxpool.Pool }

func NewReviewRepository(pool *pgxpool.Pool) *ReviewRepository { return &ReviewRepository{pool: pool} }

// ListDue returns unlearned cards due today. Cards without a progress row are treated as box 1, due today.
func (r *ReviewRepository) ListDue(ctx context.Context, userID uuid.UUID, today time.Time, limit int) ([]domain.DueCard, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT w.id, w.context_id, w.user_id, w.word, w.translation, w.transcription, w.audio_url,
		       w.language, w.created_at, COALESCE(p.box_level, 1)
		FROM word_cards w
		LEFT JOIN word_progress p ON p.word_id = w.id
		WHERE w.user_id = $1
		  AND COALESCE(p.is_learned, false) = false
		  AND COALESCE(p.next_review_at, $2::date) <= $2::date
		ORDER BY COALESCE(p.next_review_at, $2::date), w.created_at
		LIMIT $3`, userID, today, limit)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (domain.DueCard, error) {
		var d domain.DueCard
		err := row.Scan(&d.ID, &d.ContextID, &d.UserID, &d.Word, &d.Translation, &d.Transcription,
			&d.AudioURL, &d.Language, &d.CreatedAt, &d.BoxLevel)
		return d, err
	})
}

// Apply loads (creating if absent) the progress row under a row lock, transforms it and saves it atomically.
func (r *ReviewRepository) Apply(ctx context.Context, userID, wordID uuid.UUID, today time.Time,
	fn func(p domain.Progress) domain.Progress) (*domain.Progress, error) {

	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	// Ownership check.
	var exists bool
	if err := tx.QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM word_cards WHERE id = $1 AND user_id = $2)`, wordID, userID).Scan(&exists); err != nil {
		return nil, err
	}
	if !exists {
		return nil, domain.ErrNotFound
	}

	if _, err := tx.Exec(ctx,
		`INSERT INTO word_progress (word_id, user_id, box_level, next_review_at)
		 VALUES ($1, $2, 1, $3::date) ON CONFLICT (word_id) DO NOTHING`, wordID, userID, today); err != nil {
		return nil, err
	}

	p := domain.Progress{WordID: wordID, UserID: userID}
	err = tx.QueryRow(ctx,
		`SELECT box_level, correct_streak_at_max, is_learned, next_review_at, last_reviewed_at
		 FROM word_progress WHERE word_id = $1 FOR UPDATE`, wordID).
		Scan(&p.BoxLevel, &p.CorrectStreakAtMax, &p.IsLearned, &p.NextReviewAt, &p.LastReviewedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.ErrNotFound
	}
	if err != nil {
		return nil, err
	}

	p = fn(p)

	if _, err := tx.Exec(ctx,
		`UPDATE word_progress SET box_level = $2, correct_streak_at_max = $3, is_learned = $4,
		        next_review_at = $5::date, last_reviewed_at = $6 WHERE word_id = $1`,
		wordID, p.BoxLevel, p.CorrectStreakAtMax, p.IsLearned, p.NextReviewAt, p.LastReviewedAt); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return &p, nil
}
