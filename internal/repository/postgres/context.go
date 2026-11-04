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
		return insertContext(ctx, tx, c, cards)
	})
}

// CreateFolderWithContexts creates a folder and fills it with contexts and cards — the same inserts
// as CreateWithCards — in ONE transaction: either the whole folder is there or nothing is.
func (r *ContextRepository) CreateFolderWithContexts(ctx context.Context, f *domain.Folder, items []domain.ContextWithCards) error {
	return pgx.BeginFunc(ctx, r.pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx,
			`INSERT INTO folders (id, user_id, name, color, created_at) VALUES ($1, $2, $3, $4, $5)`,
			f.ID, f.UserID, f.Name, f.Color, f.CreatedAt); err != nil {
			return err
		}
		for i := range items {
			if err := insertContext(ctx, tx, &items[i].Context, items[i].Cards); err != nil {
				return err
			}
		}
		return nil
	})
}

func insertContext(ctx context.Context, tx pgx.Tx, c *domain.Context, cards []domain.WordCard) error {
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
			 example_sentence, example_translation, folder_id, lemma, article, plural, part_of_speech, translation_language,
			 example_translation_language, paused, example_gap_answer)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
			        (SELECT f.id FROM folders f WHERE f.id = $12 AND f.user_id = $3), $13, $14, $15, $16, $17, $18, $19, NULLIF($20, ''))`,
			w.ID, w.ContextID, w.UserID, w.Word, w.Translation, w.Transcription, w.AudioURL, w.Language, w.CreatedAt,
			w.ExampleSentence, w.ExampleTranslation, w.FolderID, w.Lemma, w.Article, w.Plural, w.PartOfSpeech, w.TranslationLanguage,
			w.ExampleTranslationLanguage, w.Paused, w.ExampleGapAnswer)
		// The same translation is the cache entry for its own language (training reads it from there).
		// (the example translation only when it is written in that same language)
		if w.TranslationLanguage != nil && strings.TrimSpace(w.Translation) != "" {
			batch.Queue(`INSERT INTO word_translations (word_id, language, translation, example_translation)
				VALUES ($1, $2, $3, $4)
				ON CONFLICT (word_id, language) DO UPDATE
				SET translation = EXCLUDED.translation, example_translation = EXCLUDED.example_translation`,
				w.ID, *w.TranslationLanguage, w.Translation, w.ExampleInLanguage(*w.TranslationLanguage))
		}
	}
	return tx.SendBatch(ctx, batch).Close()
}
