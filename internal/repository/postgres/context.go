package postgres

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"learnwords/internal/domain"
)

type ContextRepository struct{ pool *pgxpool.Pool }

func NewContextRepository(pool *pgxpool.Pool) *ContextRepository {
	return &ContextRepository{pool: pool}
}

// CreateWithCards stores a context and its word cards atomically.
func (r *ContextRepository) CreateWithCards(ctx context.Context, c *domain.Context, cards []domain.WordCard) error {
	return pgx.BeginFunc(ctx, r.pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx,
			`INSERT INTO contexts (id, user_id, image_url, source_text, language, created_at)
			 VALUES ($1, $2, $3, $4, $5, $6)`,
			c.ID, c.UserID, c.ImageURL, c.SourceText, c.Language, c.CreatedAt); err != nil {
			return err
		}
		batch := &pgx.Batch{}
		for _, w := range cards {
			batch.Queue(`INSERT INTO word_cards
				(id, context_id, user_id, word, translation, transcription, audio_url, language, created_at)
				VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
				w.ID, w.ContextID, w.UserID, w.Word, w.Translation, w.Transcription, w.AudioURL, w.Language, w.CreatedAt)
		}
		return tx.SendBatch(ctx, batch).Close()
	})
}

func (r *ContextRepository) ListByUser(ctx context.Context, userID uuid.UUID, limit, offset int) ([]domain.Context, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT id, user_id, image_url, source_text, language, created_at
		 FROM contexts WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
		userID, limit, offset)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (domain.Context, error) {
		var c domain.Context
		err := row.Scan(&c.ID, &c.UserID, &c.ImageURL, &c.SourceText, &c.Language, &c.CreatedAt)
		return c, err
	})
}

func (r *ContextRepository) GetByID(ctx context.Context, userID, id uuid.UUID) (*domain.Context, error) {
	var c domain.Context
	err := r.pool.QueryRow(ctx,
		`SELECT id, user_id, image_url, source_text, language, created_at
		 FROM contexts WHERE id = $1 AND user_id = $2`, id, userID).
		Scan(&c.ID, &c.UserID, &c.ImageURL, &c.SourceText, &c.Language, &c.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &c, nil
}
