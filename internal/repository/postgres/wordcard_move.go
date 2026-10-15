package postgres

import (
	"context"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"learnwords/internal/domain"
)

// MoveWords puts the user's words into folder (nil = no folder) in one transaction. Only
// word_cards.folder_id changes: word_progress (box, review date) and stats are not touched.
// If any word or the folder is not the user's, nothing is changed and ErrNotFound is returned.
// ids must be unique. Previous folders come back in the order of ids.
func (r *WordCardRepository) MoveWords(ctx context.Context, userID uuid.UUID, ids []uuid.UUID, folder *uuid.UUID) ([]domain.WordFolder, error) {
	var prev []domain.WordFolder
	err := pgx.BeginFunc(ctx, r.pool, func(tx pgx.Tx) error {
		if folder != nil {
			var ok bool
			if err := tx.QueryRow(ctx,
				`SELECT EXISTS (SELECT 1 FROM folders WHERE id = $1 AND user_id = $2)`, *folder, userID).Scan(&ok); err != nil {
				return err
			}
			if !ok {
				return domain.ErrNotFound
			}
		}
		// FOR UPDATE: the previous folders we report are the ones we overwrite.
		rows, err := tx.Query(ctx, `
			SELECT id, folder_id FROM word_cards WHERE id = ANY($1) AND user_id = $2 FOR UPDATE`, ids, userID)
		if err != nil {
			return err
		}
		found, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (domain.WordFolder, error) {
			var w domain.WordFolder
			err := row.Scan(&w.WordID, &w.FolderID)
			return w, err
		})
		if err != nil {
			return err
		}
		if len(found) != len(ids) {
			return domain.ErrNotFound
		}
		byID := make(map[uuid.UUID]domain.WordFolder, len(found))
		for _, w := range found {
			byID[w.WordID] = w
		}
		prev = make([]domain.WordFolder, 0, len(ids))
		for _, id := range ids {
			prev = append(prev, byID[id])
		}
		_, err = tx.Exec(ctx, `UPDATE word_cards SET folder_id = $3 WHERE id = ANY($1) AND user_id = $2`, ids, userID, folder)
		return err
	})
	if err != nil {
		return nil, err
	}
	return prev, nil
}
