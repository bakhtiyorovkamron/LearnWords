package postgres

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"learnwords/internal/domain"
)

func scanUser(row pgx.Row) (*domain.User, error) {
	var u domain.User
	err := row.Scan(&u.ID, &u.Email, &u.PasswordHash, &u.Role, &u.IsBanned, &u.LearningLanguage, &u.NeedsLanguage, &u.CreatedAt, &u.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &u, nil
}

// GetByTelegramChat returns the user bound to the Telegram chat (ErrNotFound when none).
func (r *UserRepository) GetByTelegramChat(ctx context.Context, chatID int64) (*domain.User, error) {
	return scanUser(r.pool.QueryRow(ctx, `SELECT `+userCols+` FROM users WHERE telegram_chat_id = $1`, chatID))
}

// FindOrCreateTelegramUser, in one transaction: the user bound to the chat; else the account once
// created for this chat (its email; the chat was moved to another account since) gets the chat back;
// else u is inserted with the Telegram profile (bound to the chat, needs_language). created = u was
// inserted. ErrAlreadyExists when a concurrent call inserted it first (reading again finds it).
func (r *UserRepository) FindOrCreateTelegramUser(ctx context.Context, u *domain.User, p domain.TelegramProfile) (*domain.User, bool, error) {
	var out *domain.User
	created := false
	err := pgx.BeginFunc(ctx, r.pool, func(tx pgx.Tx) error {
		found, err := scanUser(tx.QueryRow(ctx, `SELECT `+userCols+` FROM users WHERE telegram_chat_id = $1`, p.ChatID))
		if err == nil {
			out = found
			return nil
		}
		if !errors.Is(err, domain.ErrNotFound) {
			return err
		}
		// Registering with this domain is refused, so an account with this email was made for this chat.
		found, err = scanUser(tx.QueryRow(ctx, `UPDATE users SET telegram_chat_id = $2, telegram_username = $3, telegram_linked_at = $4,
			telegram_blocked_at = NULL, updated_at = now() WHERE email = $1 AND telegram_chat_id IS NULL RETURNING `+userCols,
			u.Email, p.ChatID, p.Username, p.CreatedAt))
		if err == nil {
			out = found
			return nil
		}
		if !errors.Is(err, domain.ErrNotFound) {
			return err
		}
		if _, err := tx.Exec(ctx, `INSERT INTO users (id, email, password_hash, learning_language, needs_language, full_name,
			telegram_username, telegram_chat_id, telegram_linked_at, telegram_lang, created_at, updated_at)
			VALUES ($1, $2, $3, $4, true, $5, $6, $7, $8, $9, $10, $10)`,
			u.ID, u.Email, u.PasswordHash, u.LearningLanguage, p.FullName, p.Username, p.ChatID, p.CreatedAt, p.Lang, u.CreatedAt); err != nil {
			var pgErr *pgconn.PgError
			if errors.As(err, &pgErr) && pgErr.Code == "23505" {
				return domain.ErrAlreadyExists
			}
			return err
		}
		inserted := *u
		inserted.Role, inserted.NeedsLanguage, inserted.UpdatedAt = domain.RoleUser, true, u.CreatedAt
		out, created = &inserted, true
		return nil
	})
	if err != nil {
		return nil, false, err
	}
	return out, created, nil
}

// SetFirstLearningLanguage sets the learning language of an account that has not chosen it yet
// (needs_language) and clears the flag. false = it had chosen already: nothing changes.
func (r *UserRepository) SetFirstLearningLanguage(ctx context.Context, id uuid.UUID, lang string) (bool, error) {
	tag, err := r.pool.Exec(ctx, `UPDATE users SET learning_language = $2, needs_language = false, updated_at = now()
		WHERE id = $1 AND needs_language`, id, lang)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}
