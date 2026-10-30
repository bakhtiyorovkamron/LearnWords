package postgres

import (
	"context"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"learnwords/internal/domain"
)

type PushRepository struct{ pool *pgxpool.Pool }

func NewPushRepository(pool *pgxpool.Pool) *PushRepository { return &PushRepository{pool: pool} }

// Upsert stores a device by its endpoint. A known endpoint (the same browser, now logged in as
// someone else, or with refreshed keys) is reassigned and updated.
func (r *PushRepository) Upsert(ctx context.Context, userID uuid.UUID, endpoint, p256dh, auth, userAgent string) error {
	_, err := r.pool.Exec(ctx, `
		INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent) VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (endpoint) DO UPDATE
		  SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, user_agent = EXCLUDED.user_agent`,
		userID, endpoint, p256dh, auth, userAgent)
	return err
}

// DeleteOwn removes the user's own subscription; someone else's endpoint is left alone (no error).
func (r *PushRepository) DeleteOwn(ctx context.Context, userID uuid.UUID, endpoint string) error {
	_, err := r.pool.Exec(ctx, `DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2`, userID, endpoint)
	return err
}

// DeleteEndpoint removes a subscription the push service reported as gone (404/410).
func (r *PushRepository) DeleteEndpoint(ctx context.Context, endpoint string) error {
	_, err := r.pool.Exec(ctx, `DELETE FROM push_subscriptions WHERE endpoint = $1`, endpoint)
	return err
}

func (r *PushRepository) MarkSuccess(ctx context.Context, endpoint string) error {
	_, err := r.pool.Exec(ctx, `UPDATE push_subscriptions SET last_success_at = now() WHERE endpoint = $1`, endpoint)
	return err
}

const pushCols = `id, user_id, endpoint, p256dh, auth`

func scanPush(row pgx.CollectableRow) (domain.PushSubscription, error) {
	var s domain.PushSubscription
	err := row.Scan(&s.ID, &s.UserID, &s.Endpoint, &s.P256dh, &s.Auth)
	return s, err
}

func (r *PushRepository) All(ctx context.Context) ([]domain.PushSubscription, error) {
	rows, err := r.pool.Query(ctx, `SELECT `+pushCols+` FROM push_subscriptions ORDER BY created_at`)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, scanPush)
}

func (r *PushRepository) ByUser(ctx context.Context, userID uuid.UUID) ([]domain.PushSubscription, error) {
	rows, err := r.pool.Query(ctx, `SELECT `+pushCols+` FROM push_subscriptions WHERE user_id = $1 ORDER BY created_at`, userID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, scanPush)
}

// Stats: how many devices are subscribed and how many distinct users they belong to.
func (r *PushRepository) Stats(ctx context.Context) (devices, users int, err error) {
	err = r.pool.QueryRow(ctx, `SELECT count(*), count(DISTINCT user_id) FROM push_subscriptions`).Scan(&devices, &users)
	return devices, users, err
}
