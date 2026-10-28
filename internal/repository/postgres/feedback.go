package postgres

import (
	"context"
	"math"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"learnwords/internal/domain"
)

type FeedbackRepository struct{ pool *pgxpool.Pool }

func NewFeedbackRepository(pool *pgxpool.Pool) *FeedbackRepository {
	return &FeedbackRepository{pool: pool}
}

// Answered reports whether the user already rated or dismissed the window.
func (r *FeedbackRepository) Answered(ctx context.Context, userID uuid.UUID) (bool, error) {
	var ok bool
	err := r.pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM feedback WHERE user_id = $1)`, userID).Scan(&ok)
	return ok, err
}

// Submit stores the rating. Only the first answer counts: a later one changes nothing.
func (r *FeedbackRepository) Submit(ctx context.Context, userID uuid.UUID, rating int, comment string) error {
	_, err := r.pool.Exec(ctx, `
		INSERT INTO feedback (user_id, rating, comment) VALUES ($1, $2, $3)
		ON CONFLICT (user_id) DO NOTHING`, userID, rating, comment)
	return err
}

// Dismiss records that the window was closed without a rating (first answer only, like Submit).
func (r *FeedbackRepository) Dismiss(ctx context.Context, userID uuid.UUID) error {
	_, err := r.pool.Exec(ctx, `
		INSERT INTO feedback (user_id, dismissed) VALUES ($1, true)
		ON CONFLICT (user_id) DO NOTHING`, userID)
	return err
}

// Summary lists the ratings (not the dismissed windows), newest first, with their average.
func (r *FeedbackRepository) Summary(ctx context.Context) (domain.FeedbackSummary, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT u.email, f.rating, f.comment, f.created_at
		FROM feedback f JOIN users u ON u.id = f.user_id
		WHERE f.rating IS NOT NULL
		ORDER BY f.created_at DESC`)
	if err != nil {
		return domain.FeedbackSummary{}, err
	}
	items, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (domain.FeedbackItem, error) {
		var it domain.FeedbackItem
		err := row.Scan(&it.Email, &it.Rating, &it.Comment, &it.CreatedAt)
		return it, err
	})
	if err != nil {
		return domain.FeedbackSummary{}, err
	}
	if items == nil {
		items = []domain.FeedbackItem{}
	}
	sum := 0
	for _, it := range items {
		sum += it.Rating
	}
	s := domain.FeedbackSummary{Count: len(items), Items: items}
	if len(items) > 0 {
		s.Average = math.Round(float64(sum)/float64(len(items))*10) / 10
	}
	return s, nil
}
