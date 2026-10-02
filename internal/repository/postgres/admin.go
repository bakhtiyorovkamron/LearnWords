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

// AdminRepository holds cross-user queries used only by the admin panel.
type AdminRepository struct{ pool *pgxpool.Pool }

func NewAdminRepository(pool *pgxpool.Pool) *AdminRepository { return &AdminRepository{pool: pool} }

// UserStatus returns the current role and ban flag (checked on every authenticated request).
func (r *AdminRepository) UserStatus(ctx context.Context, id uuid.UUID) (string, bool, error) {
	var (
		role   string
		banned bool
	)
	err := r.pool.QueryRow(ctx, `SELECT role, is_banned FROM users WHERE id = $1`, id).Scan(&role, &banned)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", false, domain.ErrNotFound
	}
	return role, banned, err
}

// ListUsers returns all users with word counts and last activity (latest review, word or story).
func (r *AdminRepository) ListUsers(ctx context.Context) ([]domain.AdminUser, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT u.id, u.email, u.role, u.is_banned, u.created_at,
		       COALESCE(w.cnt, 0),
		       GREATEST(w.last_at, rl.last_at, s.last_at)
		FROM users u
		LEFT JOIN (SELECT user_id, count(*) AS cnt, max(created_at) AS last_at
		           FROM word_cards GROUP BY user_id) w ON w.user_id = u.id
		LEFT JOIN (SELECT user_id, max(reviewed_at) AS last_at
		           FROM review_logs GROUP BY user_id) rl ON rl.user_id = u.id
		LEFT JOIN (SELECT user_id, max(created_at) AS last_at
		           FROM daily_stories GROUP BY user_id) s ON s.user_id = u.id
		ORDER BY u.created_at DESC`)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (domain.AdminUser, error) {
		var u domain.AdminUser
		err := row.Scan(&u.ID, &u.Email, &u.Role, &u.IsBanned, &u.CreatedAt, &u.WordsCount, &u.LastActivityAt)
		return u, err
	})
}

// Stats returns service-wide totals.
func (r *AdminRepository) Stats(ctx context.Context) (domain.AdminStats, error) {
	var s domain.AdminStats
	weekAgo := time.Now().UTC().AddDate(0, 0, -7)
	monthAgo := time.Now().UTC().AddDate(0, 0, -30)
	err := r.pool.QueryRow(ctx, `
		SELECT
		  (SELECT count(*) FROM users),
		  (SELECT count(*) FROM users WHERE is_banned),
		  (SELECT count(*) FROM users WHERE created_at >= $1),
		  (SELECT count(DISTINCT user_id) FROM review_logs WHERE reviewed_at >= $1),
		  (SELECT count(*) FROM word_cards),
		  (SELECT count(*) FROM review_logs),
		  (SELECT count(*) FROM (SELECT DISTINCT user_id, (reviewed_at AT TIME ZONE 'UTC')::date FROM review_logs) t),
		  (SELECT count(*) FROM daily_stories),
		  (SELECT count(*) FROM daily_stories WHERE created_at >= $2)`,
		weekAgo, monthAgo).Scan(
		&s.TotalUsers, &s.BannedUsers, &s.NewUsers7d, &s.ActiveUsers7d,
		&s.TotalWords, &s.TotalReviews, &s.TrainingSessions,
		&s.TotalStories, &s.Stories30d)
	return s, err
}

// DeleteUser removes the user; all their data goes away via ON DELETE CASCADE.
func (r *AdminRepository) DeleteUser(ctx context.Context, id uuid.UUID) error {
	tag, err := r.pool.Exec(ctx, `DELETE FROM users WHERE id = $1`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	return nil
}

// SetBanned bans or unbans a user.
func (r *AdminRepository) SetBanned(ctx context.Context, id uuid.UUID, banned bool) error {
	tag, err := r.pool.Exec(ctx,
		`UPDATE users SET is_banned = $2, updated_at = now() WHERE id = $1`, id, banned)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	return nil
}
