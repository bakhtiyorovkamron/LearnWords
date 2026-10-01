package postgres

import (
	"context"

	"github.com/google/uuid"

	"learnwords/internal/domain"
)

// Delete removes a context owned by the user.
// Its word cards (and their progress) are removed by ON DELETE CASCADE.
func (r *ContextRepository) Delete(ctx context.Context, userID, id uuid.UUID) error {
	tag, err := r.pool.Exec(ctx, `DELETE FROM contexts WHERE id = $1 AND user_id = $2`, id, userID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	return nil
}
