package postgres

import (
	"context"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"learnwords/internal/domain"
)

type ContextRepository struct{ pool *pgxpool.Pool }

func NewContextRepository(pool *pgxpool.Pool) *ContextRepository {
	return &ContextRepository{pool: pool}
}

const contextCols = `id, user_id, source_text, language, created_at, meaning`

// CreateWithCards stores a context and its word cards atomically.
func (r *ContextRepository) CreateWithCards(ctx context.Context, c *domain.Context, cards []domain.WordCard) error {
	return pgx.BeginFunc(ctx, r.pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx,
			`INSERT INTO contexts (`+contextCols+`) VALUES ($1, $2, $3, $4, $5, $6)`,
			c.ID, c.UserID, c.SourceText, c.Language, c.CreatedAt, c.Meaning); err != nil {
			return err
		}
		batch := &pgx.Batch{}
		for _, w := range cards {
			// folder_id is taken only if that folder belongs to the same user (otherwise NULL).
			batch.Queue(`INSERT INTO word_cards
				(id, context_id, user_id, word, translation, transcription, audio_url, language, created_at,
				 example_sentence, example_translation, folder_id, lemma, article, plural, part_of_speech, translation_language)
				VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
				        (SELECT f.id FROM folders f WHERE f.id = $12 AND f.user_id = $3), $13, $14, $15, $16, $17)`,
				w.ID, w.ContextID, w.UserID, w.Word, w.Translation, w.Transcription, w.AudioURL, w.Language, w.CreatedAt,
				w.ExampleSentence, w.ExampleTranslation, w.FolderID, w.Lemma, w.Article, w.Plural, w.PartOfSpeech, w.TranslationLanguage)
			// The same translation is the cache entry for its own language (training reads it from there).
			if w.TranslationLanguage != nil && strings.TrimSpace(w.Translation) != "" {
				batch.Queue(`INSERT INTO word_translations (word_id, language, translation, example_translation)
					VALUES ($1, $2, $3, $4)
					ON CONFLICT (word_id, language) DO UPDATE
					SET translation = EXCLUDED.translation, example_translation = EXCLUDED.example_translation`,
					w.ID, *w.TranslationLanguage, w.Translation, w.ExampleTranslation)
			}
		}
		return tx.SendBatch(ctx, batch).Close()
	})
}
