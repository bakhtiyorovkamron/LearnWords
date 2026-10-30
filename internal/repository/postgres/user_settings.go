package postgres

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"learnwords/internal/domain"
)

// InterfaceLanguage returns the user's saved UI language ("" if not chosen yet).
func (r *UserRepository) InterfaceLanguage(ctx context.Context, id uuid.UUID) (string, error) {
	var lang *string
	err := r.pool.QueryRow(ctx, `SELECT interface_language FROM users WHERE id = $1`, id).Scan(&lang)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", domain.ErrNotFound
	}
	if err != nil || lang == nil {
		return "", err
	}
	return *lang, nil
}

// SetInterfaceLanguage stores the user's UI language.
func (r *UserRepository) SetInterfaceLanguage(ctx context.Context, id uuid.UUID, lang string) error {
	tag, err := r.pool.Exec(ctx,
		`UPDATE users SET interface_language = $2, updated_at = now() WHERE id = $1`, id, lang)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	return nil
}

// ReviewSessionSize returns the user's saved training-session size ("" if not chosen yet).
func (r *UserRepository) ReviewSessionSize(ctx context.Context, id uuid.UUID) (string, error) {
	var size *string
	err := r.pool.QueryRow(ctx, `SELECT review_session_size FROM users WHERE id = $1`, id).Scan(&size)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", domain.ErrNotFound
	}
	if err != nil || size == nil {
		return "", err
	}
	return *size, nil
}

// SetReviewSessionSize stores the user's training-session size.
func (r *UserRepository) SetReviewSessionSize(ctx context.Context, id uuid.UUID, size string) error {
	tag, err := r.pool.Exec(ctx,
		`UPDATE users SET review_session_size = $2, updated_at = now() WHERE id = $1`, id, size)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	return nil
}

// Theme returns the user's saved colour theme ("" if never chosen).
func (r *UserRepository) Theme(ctx context.Context, id uuid.UUID) (string, error) {
	var theme *string
	err := r.pool.QueryRow(ctx, `SELECT theme FROM users WHERE id = $1`, id).Scan(&theme)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", domain.ErrNotFound
	}
	if err != nil || theme == nil {
		return "", err
	}
	return *theme, nil
}

// SetTheme stores the user's colour theme (the database accepts only the known names).
func (r *UserRepository) SetTheme(ctx context.Context, id uuid.UUID, theme string) error {
	tag, err := r.pool.Exec(ctx,
		`UPDATE users SET theme = $2, updated_at = now() WHERE id = $1`, id, theme)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	return nil
}
