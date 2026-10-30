package postgres

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"learnwords/internal/domain"
)

type WordCardRepository struct{ pool *pgxpool.Pool }

func NewWordCardRepository(pool *pgxpool.Pool) *WordCardRepository {
	return &WordCardRepository{pool: pool}
}

const cardCols = `id, context_id, user_id, word, translation, transcription, audio_url, language, created_at, example_sentence, example_translation, folder_id, lemma, article, plural, part_of_speech, translation_language, example_translation_language`

func scanCard(row pgx.Row) (domain.WordCard, error) {
	var w domain.WordCard
	err := row.Scan(&w.ID, &w.ContextID, &w.UserID, &w.Word, &w.Translation,
		&w.Transcription, &w.AudioURL, &w.Language, &w.CreatedAt, &w.ExampleSentence, &w.ExampleTranslation, &w.FolderID,
		&w.Lemma, &w.Article, &w.Plural, &w.PartOfSpeech, &w.TranslationLanguage, &w.ExampleTranslationLanguage)
	return w, err
}

func collectCards(rows pgx.Rows) ([]domain.WordCard, error) {
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (domain.WordCard, error) { return scanCard(row) })
}

func (r *WordCardRepository) ListByUser(ctx context.Context, userID uuid.UUID, limit, offset int) ([]domain.WordCard, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT `+cardCols+` FROM word_cards WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
		userID, limit, offset)
	if err != nil {
		return nil, err
	}
	return collectCards(rows)
}

func (r *WordCardRepository) GetByID(ctx context.Context, userID, id uuid.UUID) (*domain.WordCard, error) {
	w, err := scanCard(r.pool.QueryRow(ctx,
		`SELECT `+cardCols+` FROM word_cards WHERE id = $1 AND user_id = $2`, id, userID))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &w, nil
}
