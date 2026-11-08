package postgres

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"learnwords/internal/domain"
)

// Profile returns the user's name, phone and Telegram username (each nil when not set), whether
// Telegram is connected and the credits connecting it gave.
func (r *UserRepository) Profile(ctx context.Context, id uuid.UUID) (domain.Profile, error) {
	var p domain.Profile
	err := r.pool.QueryRow(ctx, `SELECT u.full_name, u.phone, u.telegram_username, u.telegram_chat_id IS NOT NULL,
		       COALESCE((SELECT b.credits FROM telegram_bonuses b WHERE b.user_id = u.id), 0)
		FROM users u WHERE u.id = $1`, id).
		Scan(&p.FullName, &p.Phone, &p.TelegramUsername, &p.TelegramConnected, &p.TelegramBonus)
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.Profile{}, domain.ErrNotFound
	}
	return p, err
}

// SetProfile stores the (already validated) name and phone; a nil phone clears it. The Telegram
// username is never touched here — only the bot sets it.
func (r *UserRepository) SetProfile(ctx context.Context, id uuid.UUID, fullName string, phone *string) error {
	tag, err := r.pool.Exec(ctx, `UPDATE users SET full_name = $2, phone = $3, updated_at = now() WHERE id = $1`, id, fullName, phone)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	return nil
}
