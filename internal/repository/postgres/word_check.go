package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"learnwords/internal/domain"
)

// WordCheckCacheRepository stores validated word-check results (shared by all users).
type WordCheckCacheRepository struct{ pool *pgxpool.Pool }

func NewWordCheckCacheRepository(pool *pgxpool.Pool) *WordCheckCacheRepository {
	return &WordCheckCacheRepository{pool: pool}
}

func (r *WordCheckCacheRepository) Get(ctx context.Context, key string) (domain.WordCheck, bool, error) {
	var raw []byte
	err := r.pool.QueryRow(ctx, `SELECT result_json FROM word_check_cache WHERE cache_key = $1`, key).Scan(&raw)
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.WordCheck{}, false, nil
	}
	if err != nil {
		return domain.WordCheck{}, false, err
	}
	var w domain.WordCheck
	if err := json.Unmarshal(raw, &w); err != nil {
		return domain.WordCheck{}, false, nil // broken entry → miss, overwritten by the next Put
	}
	return w, true, nil
}

func (r *WordCheckCacheRepository) Put(ctx context.Context, key string, w domain.WordCheck) error {
	raw, err := json.Marshal(w)
	if err != nil {
		return err
	}
	_, err = r.pool.Exec(ctx, `
		INSERT INTO word_check_cache (cache_key, result_json) VALUES ($1, $2)
		ON CONFLICT (cache_key) DO UPDATE SET result_json = EXCLUDED.result_json, created_at = now()`, key, raw)
	return err
}

// WordFixRepository: the admin "check existing words" job and the user's review of its suggestions.
type WordFixRepository struct{ pool *pgxpool.Pool }

func NewWordFixRepository(pool *pgxpool.Pool) *WordFixRepository {
	return &WordFixRepository{pool: pool}
}

// CardsToCheck returns German cards after the given id (keyset pagination), with the owner's
// interface language. Cards that already have grammar or a suggestion are skipped.
func (r *WordFixRepository) CardsToCheck(ctx context.Context, after uuid.UUID, limit int) ([]domain.CardToCheck, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT w.id, w.user_id, w.word, COALESCE(NULLIF(u.interface_language, ''), 'ru')
		FROM word_cards w
		JOIN users u ON u.id = w.user_id
		WHERE w.language = 'de' AND w.id > $1 AND w.lemma IS NULL
		  AND NOT EXISTS (SELECT 1 FROM word_fix_suggestions s WHERE s.word_id = w.id)
		ORDER BY w.id
		LIMIT $2`, after, limit)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (domain.CardToCheck, error) {
		var c domain.CardToCheck
		err := row.Scan(&c.ID, &c.UserID, &c.Word, &c.NativeLang)
		return c, err
	})
}

// CountCardsToCheck is the job's total for the progress display.
func (r *WordFixRepository) CountCardsToCheck(ctx context.Context) (int, error) {
	var n int
	err := r.pool.QueryRow(ctx, `
		SELECT count(*) FROM word_cards w
		WHERE w.language = 'de' AND w.lemma IS NULL
		  AND NOT EXISTS (SELECT 1 FROM word_fix_suggestions s WHERE s.word_id = w.id)`).Scan(&n)
	return n, err
}

// SetGrammar fills the grammar columns of a card whose text was confirmed as correct.
// The word text itself is not touched.
func (r *WordFixRepository) SetGrammar(ctx context.Context, cardID uuid.UUID, g domain.WordGrammar) error {
	_, err := r.pool.Exec(ctx, `
		UPDATE word_cards SET lemma = $2, article = $3, plural = $4, part_of_speech = $5
		WHERE id = $1 AND lemma IS NULL`, cardID, g.Lemma, g.Article, g.Plural, g.PartOfSpeech)
	return err
}

// AddSuggestion stores a pending suggestion (no-op if the same one already exists).
func (r *WordFixRepository) AddSuggestion(ctx context.Context, s domain.WordFix) error {
	_, err := r.pool.Exec(ctx, `
		INSERT INTO word_fix_suggestions
			(user_id, word_id, original_word, suggested_word, lemma, article, plural, part_of_speech, reason)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		ON CONFLICT (word_id, suggested_word) DO NOTHING`,
		s.UserID, s.WordID, s.OriginalWord, s.SuggestedWord, s.Lemma, s.Article, s.Plural, s.PartOfSpeech, s.Reason)
	return err
}

const wordFixCols = `s.id, s.user_id, s.word_id, s.original_word, s.suggested_word, s.lemma, s.article, s.plural,
	s.part_of_speech, s.reason, s.status, s.created_at, w.translation`

func scanWordFix(row pgx.Row) (domain.WordFix, error) {
	var f domain.WordFix
	err := row.Scan(&f.ID, &f.UserID, &f.WordID, &f.OriginalWord, &f.SuggestedWord, &f.Lemma, &f.Article,
		&f.Plural, &f.PartOfSpeech, &f.Reason, &f.Status, &f.CreatedAt, &f.Translation)
	return f, err
}

// ListPending returns the user's open suggestions whose card still has the checked text.
func (r *WordFixRepository) ListPending(ctx context.Context, userID uuid.UUID) ([]domain.WordFix, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT `+wordFixCols+`
		FROM word_fix_suggestions s
		JOIN word_cards w ON w.id = s.word_id AND w.word = s.original_word
		WHERE s.user_id = $1 AND s.status = 'pending'
		ORDER BY s.created_at, s.id`, userID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (domain.WordFix, error) { return scanWordFix(row) })
}

// Accept applies the suggestion to the card (text + grammar) — only if the card still has the
// text that was checked, otherwise ErrNotFound (the user edited it meanwhile).
func (r *WordFixRepository) Accept(ctx context.Context, userID, id uuid.UUID) error {
	return pgx.BeginFunc(ctx, r.pool, func(tx pgx.Tx) error {
		f, err := scanWordFix(tx.QueryRow(ctx, `
			SELECT `+wordFixCols+`
			FROM word_fix_suggestions s JOIN word_cards w ON w.id = s.word_id
			WHERE s.id = $1 AND s.user_id = $2 AND s.status = 'pending'
			FOR UPDATE OF s`, id, userID))
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.ErrNotFound
		}
		if err != nil {
			return err
		}
		tag, err := tx.Exec(ctx, `
			UPDATE word_cards SET word = $3, lemma = $4, article = $5, plural = $6, part_of_speech = $7
			WHERE id = $1 AND user_id = $2 AND word = $8`,
			f.WordID, userID, f.SuggestedWord, f.Lemma, f.Article, f.Plural, f.PartOfSpeech, f.OriginalWord)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return domain.ErrNotFound
		}
		_, err = tx.Exec(ctx, `UPDATE word_fix_suggestions SET status = 'accepted', resolved_at = $2 WHERE id = $1`,
			id, time.Now().UTC())
		return err
	})
}

// Reject closes the suggestion; the card is left as it is.
func (r *WordFixRepository) Reject(ctx context.Context, userID, id uuid.UUID) error {
	tag, err := r.pool.Exec(ctx, `
		UPDATE word_fix_suggestions SET status = 'rejected', resolved_at = now()
		WHERE id = $1 AND user_id = $2 AND status = 'pending'`, id, userID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	return nil
}
