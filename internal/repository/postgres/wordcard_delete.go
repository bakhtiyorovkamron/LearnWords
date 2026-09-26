package postgres

import (
	"context"

	"github.com/google/uuid"

	"learnwords/internal/domain"
)

// Delete removes a word card owned by the user.
func (r *WordCardRepository) Delete(ctx context.Context, userID, id uuid.UUID) error {
	tag, err := r.pool.Exec(ctx, `DELETE FROM word_cards WHERE id = $1 AND user_id = $2`, id, userID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	return nil
}
