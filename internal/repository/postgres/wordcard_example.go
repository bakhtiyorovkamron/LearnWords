package postgres

import (
	"context"

	"github.com/google/uuid"

	"learnwords/internal/domain"
)

// UpdateExample stores the example sentence and its translation for a card owned by the user.
func (r *WordCardRepository) UpdateExample(ctx context.Context, userID, id uuid.UUID, sentence, translation string) error {
	tag, err := r.pool.Exec(ctx,
		`UPDATE word_cards SET example_sentence = $1, example_translation = $2 WHERE id = $3 AND user_id = $4`,
		sentence, translation, id, userID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	return nil
}
