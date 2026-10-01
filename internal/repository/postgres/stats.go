package postgres

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"learnwords/internal/domain"
)

type StatsRepository struct{ pool *pgxpool.Pool }

func NewStatsRepository(pool *pgxpool.Pool) *StatsRepository { return &StatsRepository{pool: pool} }

// Daily returns one row per day in [from, to] (UTC dates), including days without activity.
func (r *StatsRepository) Daily(ctx context.Context, userID uuid.UUID, from, to time.Time) ([]domain.DayStat, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT d::date,
		       COALESCE(l.reviewed, 0), COALESCE(l.correct, 0), COALESCE(w.new_words, 0)
		FROM generate_series($2::date::timestamp, $3::date::timestamp, interval '1 day') AS d
		LEFT JOIN (
			SELECT (reviewed_at AT TIME ZONE 'UTC')::date AS day,
			       count(*) AS reviewed,
			       count(*) FILTER (WHERE is_correct) AS correct
			FROM review_logs
			WHERE user_id = $1 AND reviewed_at >= ($2::date::timestamp AT TIME ZONE 'UTC')
			GROUP BY 1) l ON l.day = d::date
		LEFT JOIN (
			SELECT (created_at AT TIME ZONE 'UTC')::date AS day, count(*) AS new_words
			FROM word_cards
			WHERE user_id = $1 AND created_at >= ($2::date::timestamp AT TIME ZONE 'UTC')
			GROUP BY 1) w ON w.day = d::date
		ORDER BY d`, userID, from, to)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (domain.DayStat, error) {
		var (
			day time.Time
			s   domain.DayStat
		)
		if err := row.Scan(&day, &s.Reviewed, &s.Correct, &s.NewWords); err != nil {
			return s, err
		}
		s.Date = day.Format("2006-01-02")
		return s, nil
	})
}

// LearnedCount is the number of words the user has fully learned.
func (r *StatsRepository) LearnedCount(ctx context.Context, userID uuid.UUID) (int, error) {
	var n int
	err := r.pool.QueryRow(ctx,
		`SELECT count(*) FROM word_progress WHERE user_id = $1 AND is_learned`, userID).Scan(&n)
	return n, err
}

// ActiveDays returns every distinct UTC day with at least one answer, newest first.
func (r *StatsRepository) ActiveDays(ctx context.Context, userID uuid.UUID) ([]time.Time, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT DISTINCT (reviewed_at AT TIME ZONE 'UTC')::date AS day
		FROM review_logs WHERE user_id = $1 ORDER BY day DESC`, userID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (time.Time, error) {
		var d time.Time
		err := row.Scan(&d)
		return d, err
	})
}
