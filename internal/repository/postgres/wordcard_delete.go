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

// DeleteWords removes the user's word cards in ids in one statement and returns how many went.
// Idempotent: ids that are not the user's or are already gone are skipped silently (no
// ErrNotFound), so a client can retry the same batch. Nothing else is cleaned up by hand:
// word_progress, word_translations and word_check_cache go by ON DELETE CASCADE, and
// review_logs.word_id becomes NULL (ON DELETE SET NULL), so statistics survive.
func (r *WordCardRepository) DeleteWords(ctx context.Context, userID uuid.UUID, ids []uuid.UUID) (int, error) {
	tag, err := r.pool.Exec(ctx, `DELETE FROM word_cards WHERE user_id = $1 AND id = ANY($2)`, userID, ids)
	if err != nil {
		return 0, err
	}
	return int(tag.RowsAffected()), nil
}
