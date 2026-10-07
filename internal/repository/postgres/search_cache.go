package postgres

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"learnwords/internal/domain"
)

// SearchCacheRepository stores AI word-search results by normalized query (shared by all users).
type SearchCacheRepository struct{ pool *pgxpool.Pool }

func NewSearchCacheRepository(pool *pgxpool.Pool) *SearchCacheRepository {
	return &SearchCacheRepository{pool: pool}
}

// Get returns a non-expired cached result; ok=false on a miss.
func (r *SearchCacheRepository) Get(ctx context.Context, query string) (domain.WordInfo, bool, error) {
	var raw []byte
	err := r.pool.QueryRow(ctx,
		`SELECT result_json FROM word_search_cache WHERE query_normalized = $1 AND expires_at > now()`,
		query).Scan(&raw)
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.WordInfo{}, false, nil
	}
	if err != nil {
		return domain.WordInfo{}, false, err
	}
	var w domain.WordInfo
	if err := json.Unmarshal(raw, &w); err != nil {
		return domain.WordInfo{}, false, nil // broken entry → treat as miss, will be overwritten
	}
	return w, true, nil
}

// Put stores (or refreshes) a result for 90 days.
func (r *SearchCacheRepository) Put(ctx context.Context, query string, w domain.WordInfo) error {
	w.AlreadyAdded = false // per-user flag, never cached
	raw, err := json.Marshal(w)
	if err != nil {
		return err
	}
	_, err = r.pool.Exec(ctx, `
		INSERT INTO word_search_cache (query_normalized, result_json) VALUES ($1, $2)
		ON CONFLICT (query_normalized) DO UPDATE
		SET result_json = EXCLUDED.result_json, created_at = now(), expires_at = now() + INTERVAL '90 days'`,
		query, raw)
	return err
}
