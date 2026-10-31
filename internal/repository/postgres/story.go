package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
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
		SELECT DISTINCT ON (lower(word)) word, translation,
		       COALESCE(lemma, ''), COALESCE(article, ''), COALESCE(part_of_speech, '')
		FROM word_cards
		WHERE user_id = $1 AND (created_at AT TIME ZONE 'UTC')::date = $2::date
		ORDER BY lower(word), created_at`, userID, day)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (domain.StoryWord, error) {
		var w domain.StoryWord
		err := row.Scan(&w.Word, &w.Translation, &w.Lemma, &w.Article, &w.PartOfSpeech)
		return w, err
	})
}

// UsersWithWordsOn returns users who added words on the date but have no AI story for it yet
// (their own stories don't count: they must not stop the daily story).
func (r *StoryRepository) UsersWithWordsOn(ctx context.Context, day string) ([]uuid.UUID, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT DISTINCT w.user_id
		FROM word_cards w
		WHERE (w.created_at AT TIME ZONE 'UTC')::date = $1::date
		  AND NOT EXISTS (SELECT 1 FROM daily_stories s
		                  WHERE s.user_id = w.user_id AND s.date = $1::date AND s.source = 'ai')`, day)
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

const storyCols = `id, user_id, date, genre, title, story_de, words_used, created_at, proofread_status, source, COALESCE(translation_lang, '')`

// listStoryCols is storyCols with the text left out: the archive lists metadata, the page loads a
// story's text by id.
var listStoryCols = strings.Replace(storyCols, "story_de", "'' AS story_de", 1)

func scanStory(row pgx.Row) (domain.DailyStory, error) {
	var (
		s     domain.DailyStory
		day   time.Time
		words []byte
	)
	if err := row.Scan(&s.ID, &s.UserID, &day, &s.Genre, &s.Title, &s.StoryDE, &words, &s.CreatedAt, &s.ProofreadStatus, &s.Source, &s.TranslationLang); err != nil {
		return s, err
	}
	s.Date = day.Format("2006-01-02")
	_ = json.Unmarshal(words, &s.WordsUsed)
	if s.WordsUsed == nil {
		s.WordsUsed = []domain.StoryWord{}
	}
	return s, nil
}

// Upsert saves the AI story for (user, date), replacing a previous AI one on regeneration (own
// stories live beside it and are never touched). The
// story keeps its id, so cached translations of the previous text are deleted — they are
// regenerated from the new (proofread) text on the next view.
func (r *StoryRepository) Upsert(ctx context.Context, s domain.DailyStory) (domain.DailyStory, error) {
	words, err := json.Marshal(s.WordsUsed)
	if err != nil {
		return s, err
	}
	if s.ProofreadStatus == "" {
		s.ProofreadStatus = domain.ProofreadNone
	}
	var saved domain.DailyStory
	err = pgx.BeginFunc(ctx, r.pool, func(tx pgx.Tx) error {
		var err error
		saved, err = scanStory(tx.QueryRow(ctx, `
			INSERT INTO daily_stories (user_id, date, genre, title, story_de, words_used, proofread_status, source, translation_lang)
			VALUES ($1, $2::date, $3, $4, $5, $6::jsonb, $7, 'ai', NULLIF($8, ''))
			ON CONFLICT (user_id, date) WHERE source = 'ai' DO UPDATE
			SET genre = EXCLUDED.genre, title = EXCLUDED.title, story_de = EXCLUDED.story_de,
			    words_used = EXCLUDED.words_used, proofread_status = EXCLUDED.proofread_status, created_at = now(),
			    translation_lang = EXCLUDED.translation_lang
			RETURNING `+storyCols,
			s.UserID, s.Date, s.Genre, s.Title, s.StoryDE, string(words), s.ProofreadStatus, s.TranslationLang))
		if err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `DELETE FROM story_translations WHERE story_id = $1`, saved.ID)
		return err
	})
	return saved, err
}

// SaveCorrections stores what the proofreading step fixed in a story (statistics).
func (r *StoryRepository) SaveCorrections(ctx context.Context, storyID, userID uuid.UUID, cs []domain.StoryCorrection) error {
	if len(cs) == 0 {
		return nil
	}
	batch := &pgx.Batch{}
	for _, c := range cs {
		batch.Queue(`INSERT INTO story_corrections (story_id, user_id, from_text, to_text, why) VALUES ($1, $2, $3, $4, $5)`,
			storyID, userID, c.From, c.To, c.Why)
	}
	return r.pool.SendBatch(ctx, batch).Close()
}

// FixTranslationLang fixes the story's translation language if it has none yet and returns the
// language that is in force: the conditional UPDATE means two parallel first opens cannot fight —
// the first wins, the second gets the winner's language.
func (r *StoryRepository) FixTranslationLang(ctx context.Context, storyID uuid.UUID, lang string) (string, error) {
	var fixed string
	err := r.pool.QueryRow(ctx, `
		UPDATE daily_stories SET translation_lang = COALESCE(translation_lang, $2)
		WHERE id = $1 RETURNING translation_lang`, storyID, lang).Scan(&fixed)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", domain.ErrNotFound
	}
	return fixed, err
}

// GetTranslation returns a cached story translation; ok=false on a miss.
func (r *StoryRepository) GetTranslation(ctx context.Context, storyID uuid.UUID, lang string) (domain.StoryTranslation, bool, error) {
	var (
		tr  domain.StoryTranslation
		raw []byte
	)
	err := r.pool.QueryRow(ctx,
		`SELECT translation_text, word_glosses, source FROM story_translations WHERE story_id = $1 AND lang = $2`,
		storyID, lang).Scan(&tr.Translation, &raw, &tr.Source)
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.StoryTranslation{}, false, nil
	}
	if err != nil {
		return domain.StoryTranslation{}, false, err
	}
	_ = json.Unmarshal(raw, &tr.WordGlosses)
	return tr, true, nil
}

// PutTranslation stores (or refreshes) a story's translation for one native language.
func (r *StoryRepository) PutTranslation(ctx context.Context, storyID uuid.UUID, lang string, tr domain.StoryTranslation) error {
	glosses := tr.WordGlosses
	if glosses == nil {
		glosses = map[string]string{}
	}
	raw, err := json.Marshal(glosses)
	if err != nil {
		return err
	}
	source := tr.Source
	if source == "" {
		source = domain.StorySourceAI
	}
	_, err = r.pool.Exec(ctx, `
		INSERT INTO story_translations (story_id, lang, translation_text, word_glosses, source)
		VALUES ($1, $2, $3, $4::jsonb, $5)
		ON CONFLICT (story_id, lang) DO UPDATE
		SET translation_text = EXCLUDED.translation_text, word_glosses = EXCLUDED.word_glosses,
		    source = EXCLUDED.source`,
		storyID, lang, tr.Translation, string(raw), source)
	return err
}

// DeleteTranslation drops one cached translation (e.g. the user's own, to be regenerated by AI).
func (r *StoryRepository) DeleteTranslation(ctx context.Context, storyID uuid.UUID, lang string) error {
	_, err := r.pool.Exec(ctx, `DELETE FROM story_translations WHERE story_id = $1 AND lang = $2`, storyID, lang)
	return err
}

// ByDate returns the user's AI story for a date or domain.ErrNotFound (own stories are not "the
// story of the day": one of them must never hide it).
func (r *StoryRepository) ByDate(ctx context.Context, userID uuid.UUID, day string) (domain.DailyStory, error) {
	s, err := scanStory(r.pool.QueryRow(ctx,
		`SELECT `+storyCols+` FROM daily_stories WHERE user_id = $1 AND date = $2::date AND source = 'ai'`, userID, day))
	if errors.Is(err, pgx.ErrNoRows) {
		return s, domain.ErrNotFound
	}
	return s, err
}

// List returns the user's stories, newest first — without the text (the page loads it by id).
func (r *StoryRepository) List(ctx context.Context, userID uuid.UUID, limit int) ([]domain.DailyStory, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT `+listStoryCols+` FROM daily_stories WHERE user_id = $1 ORDER BY date DESC, created_at DESC LIMIT $2`, userID, limit)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (domain.DailyStory, error) { return scanStory(row) })
}

// ByID returns one of the user's stories (AI or own) or domain.ErrNotFound.
func (r *StoryRepository) ByID(ctx context.Context, userID, id uuid.UUID) (domain.DailyStory, error) {
	s, err := scanStory(r.pool.QueryRow(ctx,
		`SELECT `+storyCols+` FROM daily_stories WHERE id = $1 AND user_id = $2`, id, userID))
	if errors.Is(err, pgx.ErrNoRows) {
		return s, domain.ErrNotFound
	}
	return s, err
}

// CreateOwn saves a story the user wrote (source 'user'): no genre, no words, not proofread.
func (r *StoryRepository) CreateOwn(ctx context.Context, s domain.DailyStory) (domain.DailyStory, error) {
	return scanStory(r.pool.QueryRow(ctx, `
		INSERT INTO daily_stories (user_id, date, genre, title, story_de, words_used, proofread_status, source, translation_lang)
		VALUES ($1, $2::date, '', $3, $4, '[]'::jsonb, 'none', 'user', NULLIF($5, ''))
		RETURNING `+storyCols, s.UserID, s.Date, s.Title, s.StoryDE, s.TranslationLang))
}

// UpdateOwn changes the title and text of the user's own story; the cached translations of the
// previous text are dropped when the text changed. An AI story (or someone else's) is ErrNotFound.
func (r *StoryRepository) UpdateOwn(ctx context.Context, userID, id uuid.UUID, title, text string) (domain.DailyStory, error) {
	var saved domain.DailyStory
	err := pgx.BeginFunc(ctx, r.pool, func(tx pgx.Tx) error {
		var oldText string
		err := tx.QueryRow(ctx,
			`SELECT story_de FROM daily_stories WHERE id = $1 AND user_id = $2 AND source = 'user' FOR UPDATE`,
			id, userID).Scan(&oldText)
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.ErrNotFound
		}
		if err != nil {
			return err
		}
		saved, err = scanStory(tx.QueryRow(ctx,
			`UPDATE daily_stories SET title = $3, story_de = $4 WHERE id = $1 AND user_id = $2 RETURNING `+storyCols,
			id, userID, title, text))
		if err != nil {
			return err
		}
		if oldText != text {
			_, err = tx.Exec(ctx, `DELETE FROM story_translations WHERE story_id = $1`, id)
		}
		return err
	})
	return saved, err
}

// DeleteOwn removes the user's own story (translations go with it). AI stories can't be deleted here.
func (r *StoryRepository) DeleteOwn(ctx context.Context, userID, id uuid.UUID) error {
	tag, err := r.pool.Exec(ctx,
		`DELETE FROM daily_stories WHERE id = $1 AND user_id = $2 AND source = 'user'`, id, userID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	return nil
}
