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

// TelegramLoginRepository: the sign-in attempts with Telegram (telegram_logins).
type TelegramLoginRepository struct{ pool *pgxpool.Pool }

func NewTelegramLoginRepository(pool *pgxpool.Pool) *TelegramLoginRepository {
	return &TelegramLoginRepository{pool: pool}
}

const loginCols = `code, secret_hash, device, status, chat_id, user_id, new_user, expires_at, created_at`

func scanLogin(row pgx.Row) (domain.TelegramLogin, bool, error) {
	var l domain.TelegramLogin
	err := row.Scan(&l.Code, &l.SecretHash, &l.Device, &l.Status, &l.ChatID, &l.UserID, &l.NewUser, &l.ExpiresAt, &l.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.TelegramLogin{}, false, nil
	}
	if err != nil {
		return domain.TelegramLogin{}, false, err
	}
	return l, true, nil
}

// Create deletes the expired logins and stores l (pending). ErrAlreadyExists when the code is taken.
func (r *TelegramLoginRepository) Create(ctx context.Context, l domain.TelegramLogin, now time.Time) error {
	if _, err := r.pool.Exec(ctx, `DELETE FROM telegram_logins WHERE expires_at <= $1`, now); err != nil {
		return err
	}
	_, err := r.pool.Exec(ctx, `INSERT INTO telegram_logins (code, secret_hash, device, expires_at, created_at)
		VALUES ($1, $2, $3, $4, $5)`, l.Code, l.SecretHash, l.Device, l.ExpiresAt, l.CreatedAt)
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" {
		return domain.ErrAlreadyExists
	}
	return err
}

// Get reads a login by its code (found = false when there is none).
func (r *TelegramLoginRepository) Get(ctx context.Context, code string) (domain.TelegramLogin, bool, error) {
	return scanLogin(r.pool.QueryRow(ctx, `SELECT `+loginCols+` FROM telegram_logins WHERE code = $1`, code))
}

// Ask: a pending, unexpired login is now asked in chatID (one statement, so only one chat ever
// gets the question). false = it was not pending or has expired: nothing changes.
func (r *TelegramLoginRepository) Ask(ctx context.Context, code string, chatID int64, now time.Time) (domain.TelegramLogin, bool, error) {
	return scanLogin(r.pool.QueryRow(ctx, `UPDATE telegram_logins SET status = 'asked', chat_id = $2
		WHERE code = $1 AND status = 'pending' AND expires_at > $3 RETURNING `+loginCols, code, chatID, now))
}

// Decide: the asked, unexpired login of chatID becomes status — confirmed (with the user) or denied.
// false = it is not asked in that chat (any more), or it has expired: nothing changes.
func (r *TelegramLoginRepository) Decide(ctx context.Context, code string, chatID int64, now time.Time, status string, userID *uuid.UUID, newUser bool) (bool, error) {
	tag, err := r.pool.Exec(ctx, `UPDATE telegram_logins SET status = $4, user_id = $5, new_user = $6
		WHERE code = $1 AND status = 'asked' AND chat_id = $2 AND expires_at > $3`, code, chatID, now, status, userID, newUser)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}

// Collect: in ONE statement, the confirmed, unexpired login with this secret becomes used, so its
// session is handed out once. ok = false when there is no such login.
func (r *TelegramLoginRepository) Collect(ctx context.Context, secretHash []byte, now time.Time) (uuid.UUID, bool, bool, error) {
	var userID uuid.UUID
	var newUser bool
	err := r.pool.QueryRow(ctx, `UPDATE telegram_logins SET status = 'used'
		WHERE secret_hash = $1 AND status = 'confirmed' AND expires_at > $2 AND user_id IS NOT NULL
		RETURNING user_id, new_user`, secretHash, now).Scan(&userID, &newUser)
	if errors.Is(err, pgx.ErrNoRows) {
		return uuid.Nil, false, false, nil
	}
	if err != nil {
		return uuid.Nil, false, false, err
	}
	return userID, newUser, true, nil
}

// BySecret reads a login by its secret's hash (found = false when there is none).
func (r *TelegramLoginRepository) BySecret(ctx context.Context, secretHash []byte) (domain.TelegramLogin, bool, error) {
	return scanLogin(r.pool.QueryRow(ctx, `SELECT `+loginCols+` FROM telegram_logins WHERE secret_hash = $1`, secretHash))
}
