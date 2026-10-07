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

const cardCols = `id, context_id, user_id, word, translation, transcription, audio_url, language, created_at, example_sentence, example_translation, folder_id`

func scanCard(row pgx.Row) (domain.WordCard, error) {
	var w domain.WordCard
	err := row.Scan(&w.ID, &w.ContextID, &w.UserID, &w.Word, &w.Translation,
		&w.Transcription, &w.AudioURL, &w.Language, &w.CreatedAt, &w.ExampleSentence, &w.ExampleTranslation, &w.FolderID)
	return w, err
}

func collectCards(rows pgx.Rows) ([]domain.WordCard, error) {
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (domain.WordCard, error) { return scanCard(row) })
}

func (r *WordCardRepository) ListByContext(ctx context.Context, userID, contextID uuid.UUID) ([]domain.WordCard, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT `+cardCols+` FROM word_cards WHERE user_id = $1 AND context_id = $2 ORDER BY created_at`,
		userID, contextID)
	if err != nil {
		return nil, err
	}
	return collectCards(rows)
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

func (r *WordCardRepository) UpdateAudioURL(ctx context.Context, userID, id uuid.UUID, url string) error {
	tag, err := r.pool.Exec(ctx,
		`UPDATE word_cards SET audio_url = $1 WHERE id = $2 AND user_id = $3`, url, id, userID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	return nil
}
