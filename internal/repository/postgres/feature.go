package postgres

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"learnwords/internal/domain"
)

type FeatureRepository struct{ pool *pgxpool.Pool }

func NewFeatureRepository(pool *pgxpool.Pool) *FeatureRepository {
	return &FeatureRepository{pool: pool}
}

// Overrides returns the user's admin overrides by feature name.
func (r *FeatureRepository) Overrides(ctx context.Context, userID uuid.UUID) (map[string]domain.FeatureOverride, error) {
	rows, err := r.pool.Query(ctx, `SELECT feature, enabled, daily_limit FROM user_features WHERE user_id = $1`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]domain.FeatureOverride{}
	for rows.Next() {
		var name string
		var o domain.FeatureOverride
		if err := rows.Scan(&name, &o.Enabled, &o.DailyLimit); err != nil {
			return nil, err
		}
		out[name] = o
	}
	return out, rows.Err()
}

// Usage returns the user's usage counters for the day (YYYY-MM-DD) by feature name.
func (r *FeatureRepository) Usage(ctx context.Context, userID uuid.UUID, day string) (map[string]int, error) {
	rows, err := r.pool.Query(ctx, `SELECT feature, count FROM feature_usage WHERE user_id = $1 AND day = $2::date`, userID, day)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]int{}
	for rows.Next() {
		var name string
		var n int
		if err := rows.Scan(&name, &n); err != nil {
			return nil, err
		}
		out[name] = n
	}
	return out, rows.Err()
}

// Consume atomically adds n to the day's counter unless that would exceed limit. ok=false → the
// limit would be exceeded and nothing changed. The first insert is checked against the limit too.
func (r *FeatureRepository) Consume(ctx context.Context, userID uuid.UUID, feature, day string, n, limit int) (count int, ok bool, err error) {
	err = r.pool.QueryRow(ctx, `
		INSERT INTO feature_usage (user_id, feature, day, count)
		SELECT $1, $2, $3::date, $4::int WHERE $4::int <= $5::int
		ON CONFLICT (user_id, feature, day) DO UPDATE
		  SET count = feature_usage.count + $4::int
		  WHERE feature_usage.count + $4::int <= $5::int
		RETURNING count`, userID, feature, day, n, limit).Scan(&count)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, false, nil
	}
	return count, err == nil, err
}

// Refund gives n back (the counter never goes below 0).
func (r *FeatureRepository) Refund(ctx context.Context, userID uuid.UUID, feature, day string, n int) error {
	_, err := r.pool.Exec(ctx, `
		UPDATE feature_usage SET count = GREATEST(count - $4::int, 0)
		WHERE user_id = $1 AND feature = $2 AND day = $3::date`, userID, feature, day, n)
	return err
}

// SetOverride upserts the admin override. An unknown user is ErrNotFound.
func (r *FeatureRepository) SetOverride(ctx context.Context, userID uuid.UUID, feature string, enabled bool, dailyLimit *int) error {
	_, err := r.pool.Exec(ctx, `
		INSERT INTO user_features (user_id, feature, enabled, daily_limit) VALUES ($1, $2, $3, $4)
		ON CONFLICT (user_id, feature) DO UPDATE
		  SET enabled = EXCLUDED.enabled, daily_limit = EXCLUDED.daily_limit, updated_at = now()`,
		userID, feature, enabled, dailyLimit)
	var pg *pgconn.PgError
	if errors.As(err, &pg) && pg.Code == "23503" {
		return domain.ErrNotFound
	}
	return err
}
