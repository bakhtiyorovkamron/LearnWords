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

type StoryRepository struct{ pool *pgxpool.Pool }

func NewStoryRepository(pool *pgxpool.Pool) *StoryRepository { return &StoryRepository{pool: pool} }

// WordsAddedOn returns the distinct words a user added on the given UTC date (YYYY-MM-DD).
func (r *StoryRepository) WordsAddedOn(ctx context.Context, userID uuid.UUID, day string) ([]domain.StoryWord, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT DISTINCT ON (lower(word)) word, translation
		FROM word_cards
		WHERE user_id = $1 AND (created_at AT TIME ZONE 'UTC')::date = $2::date
		ORDER BY lower(word), created_at`, userID, day)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (domain.StoryWord, error) {
		var w domain.StoryWord
		err := row.Scan(&w.Word, &w.Translation)
		return w, err
	})
}

// UsersWithWordsOn returns users who added words on the date but have no story for it yet.
func (r *StoryRepository) UsersWithWordsOn(ctx context.Context, day string) ([]uuid.UUID, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT DISTINCT w.user_id
		FROM word_cards w
		WHERE (w.created_at AT TIME ZONE 'UTC')::date = $1::date
		  AND NOT EXISTS (SELECT 1 FROM daily_stories s WHERE s.user_id = w.user_id AND s.date = $1::date)`, day)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowTo[uuid.UUID])
}

// LearningLanguage returns the user's learning language (used by the daily story cron).
func (r *StoryRepository) LearningLanguage(ctx context.Context, userID uuid.UUID) (string, error) {
	var lang string
	err := r.pool.QueryRow(ctx, `SELECT learning_language FROM users WHERE id = $1`, userID).Scan(&lang)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", domain.ErrNotFound
	}
	return lang, err
}

const storyCols = `id, user_id, date, genre, title, story_de, words_used, created_at`

func scanStory(row pgx.Row) (domain.DailyStory, error) {
	var (
		s     domain.DailyStory
		day   time.Time
		words []byte
	)
	if err := row.Scan(&s.ID, &s.UserID, &day, &s.Genre, &s.Title, &s.StoryDE, &words, &s.CreatedAt); err != nil {
		return s, err
	}
	s.Date = day.Format("2006-01-02")
	_ = json.Unmarshal(words, &s.WordsUsed)
	if s.WordsUsed == nil {
		s.WordsUsed = []domain.StoryWord{}
	}
	return s, nil
}

// Upsert saves the story for (user, date), replacing a previous one on regeneration.
func (r *StoryRepository) Upsert(ctx context.Context, s domain.DailyStory) (domain.DailyStory, error) {
	words, err := json.Marshal(s.WordsUsed)
	if err != nil {
		return s, err
	}
	return scanStory(r.pool.QueryRow(ctx, `
		INSERT INTO daily_stories (user_id, date, genre, title, story_de, words_used)
		VALUES ($1, $2::date, $3, $4, $5, $6::jsonb)
		ON CONFLICT (user_id, date) DO UPDATE
		SET genre = EXCLUDED.genre, title = EXCLUDED.title, story_de = EXCLUDED.story_de,
		    words_used = EXCLUDED.words_used, created_at = now()
		RETURNING `+storyCols,
		s.UserID, s.Date, s.Genre, s.Title, s.StoryDE, string(words)))
}

// GetTranslation returns a cached story translation; ok=false on a miss.
func (r *StoryRepository) GetTranslation(ctx context.Context, storyID uuid.UUID, lang string) (translation string, wordGlosses map[string]string, ok bool, err error) {
	var raw []byte
	err = r.pool.QueryRow(ctx,
		`SELECT translation_text, word_glosses FROM story_translations WHERE story_id = $1 AND lang = $2`,
		storyID, lang).Scan(&translation, &raw)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil, false, nil
	}
	if err != nil {
		return "", nil, false, err
	}
	_ = json.Unmarshal(raw, &wordGlosses)
	return translation, wordGlosses, true, nil
}

// PutTranslation stores (or refreshes) a story's translation for one native language.
func (r *StoryRepository) PutTranslation(ctx context.Context, storyID uuid.UUID, lang, translation string, wordGlosses map[string]string) error {
	raw, err := json.Marshal(wordGlosses)
	if err != nil {
		return err
	}
	_, err = r.pool.Exec(ctx, `
		INSERT INTO story_translations (story_id, lang, translation_text, word_glosses)
		VALUES ($1, $2, $3, $4::jsonb)
		ON CONFLICT (story_id, lang) DO UPDATE
		SET translation_text = EXCLUDED.translation_text, word_glosses = EXCLUDED.word_glosses`,
		storyID, lang, translation, string(raw))
	return err
}

// ByDate returns the user's story for a date or domain.ErrNotFound.
func (r *StoryRepository) ByDate(ctx context.Context, userID uuid.UUID, day string) (domain.DailyStory, error) {
	s, err := scanStory(r.pool.QueryRow(ctx,
		`SELECT `+storyCols+` FROM daily_stories WHERE user_id = $1 AND date = $2::date`, userID, day))
	if errors.Is(err, pgx.ErrNoRows) {
		return s, domain.ErrNotFound
	}
	return s, err
}

// List returns the user's stories, newest first.
func (r *StoryRepository) List(ctx context.Context, userID uuid.UUID, limit int) ([]domain.DailyStory, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT `+storyCols+` FROM daily_stories WHERE user_id = $1 ORDER BY date DESC LIMIT $2`, userID, limit)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (domain.DailyStory, error) { return scanStory(row) })
}
