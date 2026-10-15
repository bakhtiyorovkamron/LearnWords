package postgres

import (
	"context"
	"errors"
	"strconv"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"learnwords/internal/domain"
)

// HeroRepository backs the "German hero" feature. All queries are scoped to German
// (word_cards.language = 'de') — the feature is German-only for now.
type HeroRepository struct{ pool *pgxpool.Pool }

func NewHeroRepository(pool *pgxpool.Pool) *HeroRepository { return &HeroRepository{pool: pool} }

// CountLearned returns how many German words are learned — the SAME is_learned flag the
// stats page and the Collection "Выучено" filter use (see domain.LearnedMinBox).
func (r *HeroRepository) CountLearned(ctx context.Context, userID uuid.UUID) (int, error) {
	var n int
	err := r.pool.QueryRow(ctx, `
		SELECT count(*)
		FROM word_progress p
		JOIN word_cards w ON w.id = p.word_id
		WHERE p.user_id = $1 AND p.is_learned AND w.language = 'de'`,
		userID).Scan(&n)
	return n, err
}

// CountAlmostLearned returns how many German words sit exactly at box domain.LearnedMinBox-1 —
// "almost learned", shown as a second line on the hero card. Does not affect the hero's
// stage, which is computed from CountLearned only.
func (r *HeroRepository) CountAlmostLearned(ctx context.Context, userID uuid.UUID, box int) (int, error) {
	var n int
	err := r.pool.QueryRow(ctx, `
		SELECT count(*)
		FROM word_progress p
		JOIN word_cards w ON w.id = p.word_id
		WHERE p.user_id = $1 AND p.box_level = $2 AND NOT p.is_learned AND w.language = 'de'`,
		userID, box).Scan(&n)
	return n, err
}

// heroWordSample caps LearnedWords: /api/hero is called on several pages, and the phrase only
// needs a pool to pick from — not every learned word of a user with thousands.
const heroWordSample = 300

// LearnedWords returns a random sample (≤ heroWordSample) of the user's learned German words with
// their grammar (from the word check) and cached translation into lang; the phrase is built from
// it in Go by templates.
func (r *HeroRepository) LearnedWords(ctx context.Context, userID uuid.UUID, lang string) ([]domain.HeroWord, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT w.word, COALESCE(w.lemma, ''), COALESCE(w.article, ''), COALESCE(w.part_of_speech, ''),
		       COALESCE(t.translation, '')
		FROM word_progress p
		JOIN word_cards w ON w.id = p.word_id
		LEFT JOIN word_translations t ON t.word_id = w.id AND t.language = $2
		WHERE p.user_id = $1 AND p.is_learned AND w.language = 'de'
		ORDER BY random() LIMIT `+strconv.Itoa(heroWordSample),
		userID, lang)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (domain.HeroWord, error) {
		var w domain.HeroWord
		err := row.Scan(&w.Word, &w.Lemma, &w.Article, &w.PartOfSpeech, &w.Translation)
		return w, err
	})
}

// StageSeen returns the highest stage whose congratulation was shown; ok=false if never set.
func (r *HeroRepository) StageSeen(ctx context.Context, userID uuid.UUID) (int, bool, error) {
	var s *int16
	err := r.pool.QueryRow(ctx, `SELECT hero_stage_seen FROM users WHERE id = $1`, userID).Scan(&s)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && s == nil) {
		return 0, false, nil
	}
	if err != nil {
		return 0, false, err
	}
	return int(*s), true, nil
}

func (r *HeroRepository) SetStageSeen(ctx context.Context, userID uuid.UUID, stage int) error {
	_, err := r.pool.Exec(ctx, `UPDATE users SET hero_stage_seen = $2 WHERE id = $1`, userID, stage)
	return err
}

// IntroSeen: has the user seen the one-time hero introduction.
func (r *HeroRepository) IntroSeen(ctx context.Context, userID uuid.UUID) (bool, error) {
	var seen bool
	err := r.pool.QueryRow(ctx, `SELECT hero_intro_seen FROM users WHERE id = $1`, userID).Scan(&seen)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	return seen, err
}

func (r *HeroRepository) SetIntroSeen(ctx context.Context, userID uuid.UUID) error {
	_, err := r.pool.Exec(ctx, `UPDATE users SET hero_intro_seen = true WHERE id = $1`, userID)
	return err
}

// CountDueToday counts words due for review today — the same rule as ReviewRepository.CountDue
// (unlearned, next review today or earlier, never-reviewed words count as due).
func (r *HeroRepository) CountDueToday(ctx context.Context, userID uuid.UUID, today time.Time) (int, error) {
	var n int
	err := r.pool.QueryRow(ctx, `
		SELECT count(*)
		FROM word_cards w
		LEFT JOIN word_progress p ON p.word_id = w.id
		WHERE w.user_id = $1
		  AND COALESCE(p.is_learned, false) = false
		  AND COALESCE(p.next_review_at, $2::date) <= $2::date`, userID, today).Scan(&n)
	return n, err
}

// ActiveDaysSince returns the distinct UTC days with at least one answer (review or practice,
// like the streak on the stats page) from the given day on.
func (r *HeroRepository) ActiveDaysSince(ctx context.Context, userID uuid.UUID, from time.Time) ([]time.Time, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT DISTINCT (reviewed_at AT TIME ZONE 'UTC')::date
		FROM review_logs
		WHERE user_id = $1 AND reviewed_at >= ($2::date::timestamp AT TIME ZONE 'UTC')`, userID, from)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowTo[time.Time])
}

// HeroStage returns the highest stage ever recorded for userID; ok=false if never set.
func (r *HeroRepository) HeroStage(ctx context.Context, userID uuid.UUID) (stage int, ok bool, err error) {
	var s *int16
	err = r.pool.QueryRow(ctx, `SELECT hero_stage FROM users WHERE id = $1`, userID).Scan(&s)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, false, nil
	}
	if err != nil {
		return 0, false, err
	}
	if s == nil {
		return 0, false, nil
	}
	return int(*s), true, nil
}

// SetHeroStage records the highest stage reached so far.
func (r *HeroRepository) SetHeroStage(ctx context.Context, userID uuid.UUID, stage int) error {
	_, err := r.pool.Exec(ctx, `UPDATE users SET hero_stage = $2 WHERE id = $1`, userID, stage)
	return err
}
