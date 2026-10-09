package postgres

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// WordTranslationRepository caches a word card's translation per interface language, separate
// from word_cards.translation (which is fixed to whatever language was active when it was added).
type WordTranslationRepository struct{ pool *pgxpool.Pool }

func NewWordTranslationRepository(pool *pgxpool.Pool) *WordTranslationRepository {
	return &WordTranslationRepository{pool: pool}
}

// Get returns a cached translation; ok=false on a miss.
func (r *WordTranslationRepository) Get(ctx context.Context, wordID uuid.UUID, lang string) (translation, exampleTranslation string, ok bool, err error) {
	err = r.pool.QueryRow(ctx,
		`SELECT translation, example_translation FROM word_translations WHERE word_id = $1 AND language = $2`,
		wordID, lang).Scan(&translation, &exampleTranslation)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", "", false, nil
	}
	if err != nil {
		return "", "", false, err
	}
	return translation, exampleTranslation, true, nil
}

// Put stores (or refreshes) the translation for one word in one language.
func (r *WordTranslationRepository) Put(ctx context.Context, wordID uuid.UUID, lang, translation, exampleTranslation string) error {
	_, err := r.pool.Exec(ctx, `
		INSERT INTO word_translations (word_id, language, translation, example_translation)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (word_id, language) DO UPDATE
		SET translation = EXCLUDED.translation, example_translation = EXCLUDED.example_translation`,
		wordID, lang, translation, exampleTranslation)
	return err
}
