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

// List returns the user's folders — each with its word-progress breakdown (one GROUP BY query) —
// plus the "all words" and "no folder" aggregates (one more query, not a loop over folders).
func (r *FolderRepository) List(ctx context.Context, userID uuid.UUID) (*domain.FolderList, error) {
	today := time.Now().UTC()

	rows, err := r.pool.Query(ctx, `
		SELECT f.id, f.name, f.color, f.created_at,
		       count(w.id) AS total,
		       count(w.id) FILTER (WHERE NOT COALESCE(p.is_learned, false) AND COALESCE(p.box_level, 1) <= 2) AS new_count,
		       count(w.id) FILTER (WHERE NOT COALESCE(p.is_learned, false) AND COALESCE(p.box_level, 1) BETWEEN 3 AND 5) AS learning_count,
		       count(w.id) FILTER (WHERE COALESCE(p.is_learned, false)) AS learned_count,
		       count(w.id) FILTER (WHERE NOT COALESCE(p.is_learned, false) AND COALESCE(p.next_review_at, $2::date) <= $2::date) AS due_today
		FROM folders f
		LEFT JOIN word_cards w ON w.folder_id = f.id
		LEFT JOIN word_progress p ON p.word_id = w.id
		WHERE f.user_id = $1
		GROUP BY f.id, f.name, f.color, f.created_at
		ORDER BY f.created_at`, userID, today)
	if err != nil {
		return nil, err
	}
	folders, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (domain.Folder, error) {
		f := domain.Folder{UserID: userID}
		err := row.Scan(&f.ID, &f.Name, &f.Color, &f.CreatedAt,
			&f.Total, &f.NewCount, &f.LearningCount, &f.LearnedCount, &f.DueToday)
		return f, err
	})
	if err != nil {
		return nil, err
	}

	list := &domain.FolderList{Folders: folders}
	err = r.pool.QueryRow(ctx, `
		SELECT count(*),
		       count(*) FILTER (WHERE NOT COALESCE(p.is_learned, false) AND COALESCE(p.box_level, 1) <= 2),
		       count(*) FILTER (WHERE NOT COALESCE(p.is_learned, false) AND COALESCE(p.box_level, 1) BETWEEN 3 AND 5),
		       count(*) FILTER (WHERE COALESCE(p.is_learned, false)),
		       count(*) FILTER (WHERE NOT COALESCE(p.is_learned, false) AND COALESCE(p.next_review_at, $2::date) <= $2::date),
		       count(*) FILTER (WHERE w.folder_id IS NULL),
		       count(*) FILTER (WHERE w.folder_id IS NULL AND NOT COALESCE(p.is_learned, false) AND COALESCE(p.box_level, 1) <= 2),
		       count(*) FILTER (WHERE w.folder_id IS NULL AND NOT COALESCE(p.is_learned, false) AND COALESCE(p.box_level, 1) BETWEEN 3 AND 5),
		       count(*) FILTER (WHERE w.folder_id IS NULL AND COALESCE(p.is_learned, false)),
		       count(*) FILTER (WHERE w.folder_id IS NULL AND NOT COALESCE(p.is_learned, false) AND COALESCE(p.next_review_at, $2::date) <= $2::date)
		FROM word_cards w
		LEFT JOIN word_progress p ON p.word_id = w.id
		WHERE w.user_id = $1`, userID, today).Scan(
		&list.All.Total, &list.All.NewCount, &list.All.LearningCount, &list.All.LearnedCount, &list.All.DueToday,
		&list.None.Total, &list.None.NewCount, &list.None.LearningCount, &list.None.LearnedCount, &list.None.DueToday)
	if err != nil {
		return nil, err
	}
	return list, nil
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
// Returns the folder's current word-progress breakdown alongside the new name/color.
func (r *FolderRepository) Update(ctx context.Context, userID, id uuid.UUID, name, color *string) (*domain.Folder, error) {
	today := time.Now().UTC()
	f := domain.Folder{UserID: userID}
	err := r.pool.QueryRow(ctx, `
		WITH updated AS (
			UPDATE folders SET name = COALESCE($3, name), color = COALESCE($4, color)
			WHERE id = $1 AND user_id = $2
			RETURNING id, name, color, created_at
		)
		SELECT u.id, u.name, u.color, u.created_at,
		       count(w.id),
		       count(w.id) FILTER (WHERE NOT COALESCE(p.is_learned, false) AND COALESCE(p.box_level, 1) <= 2),
		       count(w.id) FILTER (WHERE NOT COALESCE(p.is_learned, false) AND COALESCE(p.box_level, 1) BETWEEN 3 AND 5),
		       count(w.id) FILTER (WHERE COALESCE(p.is_learned, false)),
		       count(w.id) FILTER (WHERE NOT COALESCE(p.is_learned, false) AND COALESCE(p.next_review_at, $5::date) <= $5::date)
		FROM updated u
		LEFT JOIN word_cards w ON w.folder_id = u.id
		LEFT JOIN word_progress p ON p.word_id = w.id
		GROUP BY u.id, u.name, u.color, u.created_at`,
		id, userID, name, color, today).Scan(&f.ID, &f.Name, &f.Color, &f.CreatedAt,
		&f.Total, &f.NewCount, &f.LearningCount, &f.LearnedCount, &f.DueToday)
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
