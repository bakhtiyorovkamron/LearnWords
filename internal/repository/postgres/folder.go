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

type FolderRepository struct{ pool *pgxpool.Pool }

func NewFolderRepository(pool *pgxpool.Pool) *FolderRepository { return &FolderRepository{pool: pool} }

// List returns the user's folders with the number of words in each.
func (r *FolderRepository) List(ctx context.Context, userID uuid.UUID) ([]domain.Folder, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT f.id, f.user_id, f.name, f.color, f.created_at,
		       (SELECT count(*) FROM word_cards w WHERE w.folder_id = f.id)
		FROM folders f WHERE f.user_id = $1
		ORDER BY f.created_at`, userID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (domain.Folder, error) {
		var f domain.Folder
		err := row.Scan(&f.ID, &f.UserID, &f.Name, &f.Color, &f.CreatedAt, &f.WordsCount)
		return f, err
	})
}

func (r *FolderRepository) Create(ctx context.Context, userID uuid.UUID, name, color string) (*domain.Folder, error) {
	f := domain.Folder{ID: uuid.New(), UserID: userID, Name: name, Color: color, CreatedAt: time.Now().UTC()}
	if _, err := r.pool.Exec(ctx,
		`INSERT INTO folders (id, user_id, name, color, created_at) VALUES ($1, $2, $3, $4, $5)`,
		f.ID, f.UserID, f.Name, f.Color, f.CreatedAt); err != nil {
		return nil, err
	}
	return &f, nil
}

// Update renames/recolours a folder; nil = keep. Only the owner's folder is affected.
func (r *FolderRepository) Update(ctx context.Context, userID, id uuid.UUID, name, color *string) (*domain.Folder, error) {
	var f domain.Folder
	err := r.pool.QueryRow(ctx, `
		UPDATE folders SET name = COALESCE($3, name), color = COALESCE($4, color)
		WHERE id = $1 AND user_id = $2
		RETURNING id, user_id, name, color, created_at,
		          (SELECT count(*) FROM word_cards w WHERE w.folder_id = folders.id)`,
		id, userID, name, color).Scan(&f.ID, &f.UserID, &f.Name, &f.Color, &f.CreatedAt, &f.WordsCount)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &f, nil
}

// Delete removes the folder; its words stay (folder_id → NULL via ON DELETE SET NULL).
func (r *FolderRepository) Delete(ctx context.Context, userID, id uuid.UUID) error {
	tag, err := r.pool.Exec(ctx, `DELETE FROM folders WHERE id = $1 AND user_id = $2`, id, userID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	return nil
}
