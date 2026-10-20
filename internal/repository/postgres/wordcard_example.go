package postgres

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"learnwords/internal/domain"
)

// UpdateExample stores the example sentence and its translation for a card owned by the user.
// The translation is also the cache entry for the card's own translation language, and cached
// translations into other languages (of the previous example) are dropped to be regenerated.
func (r *WordCardRepository) UpdateExample(ctx context.Context, userID, id uuid.UUID, sentence, translation string) error {
	return pgx.BeginFunc(ctx, r.pool, func(tx pgx.Tx) error {
		var lang *string
		var cardTranslation string
		err := tx.QueryRow(ctx, `
			UPDATE word_cards SET example_sentence = $1, example_translation = $2
			WHERE id = $3 AND user_id = $4
			RETURNING translation_language, translation`, sentence, translation, id, userID).Scan(&lang, &cardTranslation)
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.ErrNotFound
		}
		if err != nil {
			return err
		}
		if lang == nil {
			return nil
		}
		return replaceTranslationCache(ctx, tx, id, *lang, cardTranslation, translation)
	})
}

// replaceTranslationCache makes (lang → translation, exampleTranslation) the cache entry of the
// word and drops its entries for every other language: they are regenerated from the new meaning.
func replaceTranslationCache(ctx context.Context, tx pgx.Tx, wordID uuid.UUID, lang, translation, exampleTranslation string) error {
	if _, err := tx.Exec(ctx, `DELETE FROM word_translations WHERE word_id = $1 AND language <> $2`, wordID, lang); err != nil {
		return err
	}
	if translation == "" {
		return nil
	}
	_, err := tx.Exec(ctx, `
		INSERT INTO word_translations (word_id, language, translation, example_translation)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (word_id, language) DO UPDATE
		SET translation = EXCLUDED.translation, example_translation = EXCLUDED.example_translation`,
		wordID, lang, translation, exampleTranslation)
	return err
}
