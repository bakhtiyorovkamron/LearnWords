package postgres

import (
	"context"

	"github.com/google/uuid"
)

// HasWord reports whether the user already has a card with this spelling (case-insensitive,
// surrounding spaces ignored). Any of the given forms counts, e.g. "der Hund" and "Hund".
func (r *WordCardRepository) HasWord(ctx context.Context, userID uuid.UUID, forms ...string) (bool, error) {
	var exists bool
	err := r.pool.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM word_cards
			WHERE user_id = $1 AND lower(btrim(word)) = ANY (
				SELECT lower(btrim(f)) FROM unnest($2::text[]) AS f WHERE btrim(f) <> ''
			)
		)`, userID, forms).Scan(&exists)
	return exists, err
}
