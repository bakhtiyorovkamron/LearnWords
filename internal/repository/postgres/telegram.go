package postgres

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"learnwords/internal/domain"
)

// TelegramRepository: one-time link codes and the user's bound Telegram chat.
type TelegramRepository struct{ pool *pgxpool.Pool }

func NewTelegramRepository(pool *pgxpool.Pool) *TelegramRepository {
	return &TelegramRepository{pool: pool}
}

// ReplaceLinkCode deletes the user's older codes and stores the new one (one active code per user).
func (r *TelegramRepository) ReplaceLinkCode(ctx context.Context, userID uuid.UUID, code string, expiresAt time.Time) error {
	return pgx.BeginFunc(ctx, r.pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `DELETE FROM telegram_link_codes WHERE user_id = $1`, userID); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `INSERT INTO telegram_link_codes (code, user_id, expires_at) VALUES ($1, $2, $3)`, code, userID, expiresAt)
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			return domain.ErrAlreadyExists
		}
		return err
	})
}

// BindTelegram: in one transaction, lock the active code (unused, expires_at > now), mark it used
// and bind the chat to its user (telegram_linked_at = now). The chat is first taken off any other
// account (one Telegram account, one user). false when there is no active code — a used one is
// never bound again. A bound chat also gets `bonus` photo credits, unless this chat or this user
// had them before; granted is what was given (0 or bonus).
func (r *TelegramRepository) BindTelegram(ctx context.Context, code string, chatID int64, username *string, now time.Time, bonus int) (bound bool, granted int, err error) {
	err = pgx.BeginFunc(ctx, r.pool, func(tx pgx.Tx) error {
		var userID uuid.UUID
		err := tx.QueryRow(ctx, `SELECT user_id FROM telegram_link_codes
			WHERE code = $1 AND used_at IS NULL AND expires_at > $2 FOR UPDATE`, code, now).Scan(&userID)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE telegram_link_codes SET used_at = $2 WHERE code = $1`, code, now); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE users SET telegram_chat_id = NULL, telegram_username = NULL, telegram_linked_at = NULL,
			updated_at = now() WHERE telegram_chat_id = $1 AND id <> $2`, chatID, userID); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE users SET telegram_chat_id = $2, telegram_username = $3, telegram_linked_at = $4,
			updated_at = now() WHERE id = $1`, userID, chatID, username, now); err != nil {
			return err
		}
		bound = true
		if bonus <= 0 {
			return nil
		}
		// No conflict target: a chat that already earned it and a user who already has it both skip.
		tag, err := tx.Exec(ctx, `INSERT INTO telegram_bonuses (chat_id, user_id, credits, created_at) VALUES ($1, $2, $3, $4)
			ON CONFLICT DO NOTHING`, chatID, userID, bonus, now)
		if err != nil || tag.RowsAffected() == 0 {
			return err
		}
		if _, err := addCredits(ctx, tx, userID, domain.FeaturePhotoImport, bonus, domain.CreditReasonTelegram, nil, nil, ""); err != nil {
			return err
		}
		granted = bonus
		return nil
	})
	if err != nil {
		return false, 0, err
	}
	return bound, granted, nil
}
