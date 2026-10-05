package postgres

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"learnwords/internal/domain"
)

// UpdateContent edits a card's text fields. nil fields stay unchanged.
// Progress (word_progress: box_level, is_learned, …) is deliberately not touched.
func (r *WordCardRepository) UpdateContent(ctx context.Context, userID, id uuid.UUID, u domain.WordCardUpdate) (*domain.WordCard, error) {
	w, err := scanCard(r.pool.QueryRow(ctx, `
		UPDATE word_cards SET
		  word                = COALESCE($3, word),
		  translation         = COALESCE($4, translation),
		  transcription       = COALESCE($5, transcription),
		  example_sentence    = COALESCE($6, example_sentence),
		  example_translation = COALESCE($7, example_translation)
		WHERE id = $1 AND user_id = $2
		RETURNING `+cardCols,
		id, userID, u.Word, u.Translation, u.Transcription, u.ExampleSentence, u.ExampleTranslation))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.ErrNotFound // not found or belongs to another user
	}
	if err != nil {
		return nil, err
	}
	return &w, nil
}
