package postgres

import (
	"context"
	"errors"
	"fmt"

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

// Credits returns the user's purchased balances by feature name.
func (r *FeatureRepository) Credits(ctx context.Context, userID uuid.UUID) (map[string]int, error) {
	rows, err := r.pool.Query(ctx, `SELECT feature, balance FROM feature_credits WHERE user_id = $1`, userID)
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

// Consume takes n units in one transaction: the day's free units first (up to limit), the rest
// from the purchased balance. ok=false → n does not fit into both together: nothing changed, and
// res carries the current balance and what is left of the day. The (user, feature) credits row
// (created on first use) is locked FOR UPDATE before the day's usage row: it serializes every
// credit movement of that user and feature, so parallel consumes can neither go over the limit
// nor spend one credit twice.
func (r *FeatureRepository) Consume(ctx context.Context, userID uuid.UUID, feature, day string, n, limit int) (res domain.ConsumeResult, ok bool, err error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return res, false, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck // a no-op after Commit

	balance, err := lockCredits(ctx, tx, userID, feature)
	if err != nil {
		return res, false, err
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO feature_usage (user_id, feature, day) VALUES ($1, $2, $3::date)
		ON CONFLICT (user_id, feature, day) DO NOTHING`, userID, feature, day); err != nil {
		return res, false, err
	}
	var used int
	if err := tx.QueryRow(ctx, `
		SELECT count FROM feature_usage WHERE user_id = $1 AND feature = $2 AND day = $3::date
		FOR UPDATE`, userID, feature, day).Scan(&used); err != nil {
		return res, false, err
	}

	left := max(limit-used, 0) // the admin may have lowered the limit below today's usage
	res = domain.ConsumeResult{FromDaily: min(n, left), Day: day}
	res.FromCredits = n - res.FromDaily
	if res.FromCredits > balance {
		return domain.ConsumeResult{DailyRemaining: &left, Credits: balance, Day: day}, false, nil
	}
	if res.FromDaily > 0 {
		if _, err := tx.Exec(ctx, `
			UPDATE feature_usage SET count = count + $4::int
			WHERE user_id = $1 AND feature = $2 AND day = $3::date`, userID, feature, day, res.FromDaily); err != nil {
			return domain.ConsumeResult{}, false, err
		}
	}
	if res.FromCredits > 0 {
		if _, err := tx.Exec(ctx, `
			UPDATE feature_credits SET balance = balance - $3::int, updated_at = now()
			WHERE user_id = $1 AND feature = $2`, userID, feature, res.FromCredits); err != nil {
			return domain.ConsumeResult{}, false, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return domain.ConsumeResult{}, false, err
	}
	rem := left - res.FromDaily
	res.DailyRemaining = &rem
	res.Credits = balance - res.FromCredits
	return res, true, nil
}

// lockCredits creates the (user, feature) balance row if missing and locks it for the transaction.
// An unknown user is ErrNotFound.
func lockCredits(ctx context.Context, tx pgx.Tx, userID uuid.UUID, feature string) (int, error) {
	if _, err := tx.Exec(ctx, `
		INSERT INTO feature_credits (user_id, feature) VALUES ($1, $2)
		ON CONFLICT (user_id, feature) DO NOTHING`, userID, feature); err != nil {
		return 0, notFoundOnFK(err)
	}
	var balance int
	err := tx.QueryRow(ctx, `
		SELECT balance FROM feature_credits WHERE user_id = $1 AND feature = $2
		FOR UPDATE`, userID, feature).Scan(&balance)
	return balance, err
}

// Refund gives a Consume back to the sources it came from: FromDaily to the day's counter (never
// below 0), FromCredits to the balance. Same lock order as Consume (balance, then the day).
func (r *FeatureRepository) Refund(ctx context.Context, userID uuid.UUID, feature, day string, res domain.ConsumeResult) error {
	if res.FromDaily <= 0 && res.FromCredits <= 0 {
		return nil
	}
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck // a no-op after Commit
	if res.FromCredits > 0 {
		if _, err := tx.Exec(ctx, `
			UPDATE feature_credits SET balance = balance + $3::int, updated_at = now()
			WHERE user_id = $1 AND feature = $2`, userID, feature, res.FromCredits); err != nil {
			return err
		}
	}
	if res.FromDaily > 0 {
		if _, err := tx.Exec(ctx, `
			UPDATE feature_usage SET count = GREATEST(count - $4::int, 0)
			WHERE user_id = $1 AND feature = $2 AND day = $3::date`, userID, feature, day, res.FromDaily); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

// AddCredits changes the purchased balance by delta and records it in credit_ledger, in one
// transaction. Returns the new balance. A delta that would take the balance below 0 is
// ErrValidation (nothing changes); an unknown user is ErrNotFound.
func (r *FeatureRepository) AddCredits(ctx context.Context, userID uuid.UUID, feature string, delta int, reason string, purchaseID, by *uuid.UUID, note string) (int, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck // a no-op after Commit
	balance, err := addCredits(ctx, tx, userID, feature, delta, reason, purchaseID, by, note)
	if err != nil {
		return 0, err
	}
	return balance, tx.Commit(ctx)
}

// addCredits is AddCredits inside the caller's transaction (also used by an approved purchase).
func addCredits(ctx context.Context, tx pgx.Tx, userID uuid.UUID, feature string, delta int, reason string, purchaseID, by *uuid.UUID, note string) (int, error) {
	if delta == 0 {
		return 0, fmt.Errorf("%w: amount must not be 0", domain.ErrValidation)
	}
	// Not one INSERT ... ON CONFLICT DO UPDATE: Postgres checks CHECK (balance >= 0) on the proposed
	// row before it looks for the conflict, so a negative delta would always fail.
	if _, err := tx.Exec(ctx, `
		INSERT INTO feature_credits (user_id, feature) VALUES ($1, $2)
		ON CONFLICT (user_id, feature) DO NOTHING`, userID, feature); err != nil {
		return 0, notFoundOnFK(err)
	}
	var balance int
	err := tx.QueryRow(ctx, `
		UPDATE feature_credits SET balance = balance + $3::int, updated_at = now()
		WHERE user_id = $1 AND feature = $2 AND balance + $3::int >= 0
		RETURNING balance`, userID, feature, delta).Scan(&balance)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, fmt.Errorf("%w: the balance cannot go below 0", domain.ErrValidation)
	}
	if err != nil {
		return 0, err
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO credit_ledger (user_id, feature, delta, reason, purchase_id, created_by, note)
		VALUES ($1, $2, $3, $4, $5, $6, $7)`, userID, feature, delta, reason, purchaseID, by, note); err != nil {
		return 0, err
	}
	return balance, nil
}

// notFoundOnFK turns a foreign key violation (the user does not exist) into ErrNotFound.
func notFoundOnFK(err error) error {
	var pg *pgconn.PgError
	if errors.As(err, &pg) && pg.Code == "23503" {
		return domain.ErrNotFound
	}
	return err
}

// SetOverride upserts the admin override. An unknown user is ErrNotFound.
func (r *FeatureRepository) SetOverride(ctx context.Context, userID uuid.UUID, feature string, enabled bool, dailyLimit *int) error {
	_, err := r.pool.Exec(ctx, `
		INSERT INTO user_features (user_id, feature, enabled, daily_limit) VALUES ($1, $2, $3, $4)
		ON CONFLICT (user_id, feature) DO UPDATE
		  SET enabled = EXCLUDED.enabled, daily_limit = EXCLUDED.daily_limit, updated_at = now()`,
		userID, feature, enabled, dailyLimit)
	return notFoundOnFK(err)
}
