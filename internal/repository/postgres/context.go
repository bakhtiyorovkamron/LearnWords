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

const contextCols = `id, user_id, image_url, photo_credit, source_text, language, created_at`

func scanContext(row pgx.Row) (domain.Context, error) {
	var c domain.Context
	err := row.Scan(&c.ID, &c.UserID, &c.ImageURL, &c.PhotoCredit, &c.SourceText, &c.Language, &c.CreatedAt)
	return c, err
}

// CreateWithCards stores a context and its word cards atomically.
func (r *ContextRepository) CreateWithCards(ctx context.Context, c *domain.Context, cards []domain.WordCard) error {
	return pgx.BeginFunc(ctx, r.pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx,
			`INSERT INTO contexts (`+contextCols+`) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
			c.ID, c.UserID, c.ImageURL, c.PhotoCredit, c.SourceText, c.Language, c.CreatedAt); err != nil {
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
		`SELECT `+contextCols+` FROM contexts WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
		userID, limit, offset)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (domain.Context, error) { return scanContext(row) })
}

func (r *ContextRepository) GetByID(ctx context.Context, userID, id uuid.UUID) (*domain.Context, error) {
	c, err := scanContext(r.pool.QueryRow(ctx,
		`SELECT `+contextCols+` FROM contexts WHERE id = $1 AND user_id = $2`, id, userID))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &c, nil
}

func (r *ContextRepository) UpdatePhoto(ctx context.Context, userID, id uuid.UUID, url, credit string) error {
	tag, err := r.pool.Exec(ctx,
		`UPDATE contexts SET image_url = $1, photo_credit = $2 WHERE id = $3 AND user_id = $4`,
		url, credit, id, userID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	return nil
}
