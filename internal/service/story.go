package service

import (
	"context"
	"fmt"
	"log/slog"
	"math/rand"
	"strings"
	"time"

	"github.com/google/uuid"

	"learnwords/internal/domain"
)

// StoryGenerator produces a story in the user's learning language (domain.LangFrom(ctx)) from a list of words.
type StoryGenerator interface {
	GenerateStory(ctx context.Context, words []domain.StoryWord, genre string) (domain.GeneratedStory, error)
}

// StoryTranslator translates an already-generated story (+ a gloss per word) into a native
// language. nil → translation is disabled (no AI key); the story is still shown, just without
// StoryTranslation/word glosses filled in — never a guess in the wrong language.
type StoryTranslator interface {
	TranslateStory(ctx context.Context, learningLang, nativeLang, storyDE string, words []string) (translation string, wordGlosses map[string]string, err error)
}

type StoryRepository interface {
	WordsAddedOn(ctx context.Context, userID uuid.UUID, day string) ([]domain.StoryWord, error)
	UsersWithWordsOn(ctx context.Context, day string) ([]uuid.UUID, error)
	// LearningLanguage is used by the cron job (no HTTP request → no language in ctx).
	LearningLanguage(ctx context.Context, userID uuid.UUID) (string, error)
	Upsert(ctx context.Context, s domain.DailyStory) (domain.DailyStory, error)
	ByDate(ctx context.Context, userID uuid.UUID, day string) (domain.DailyStory, error)
	List(ctx context.Context, userID uuid.UUID, limit int) ([]domain.DailyStory, error)
	GetTranslation(ctx context.Context, storyID uuid.UUID, lang string) (translation string, wordGlosses map[string]string, ok bool, err error)
	PutTranslation(ctx context.Context, storyID uuid.UUID, lang, translation string, wordGlosses map[string]string) error
}

var StoryGenres = []string{"приключение", "детектив", "комедия", "сказка", "фантастика", "повседневная жизнь", "романтика"}

// maxStoryWords caps how many of the day's words go into one story: a long word list makes the
// answer much more likely to be cut off or malformed.
const maxStoryWords = 12

type StoryService struct {
	repo       StoryRepository
	gen        StoryGenerator  // nil when ANTHROPIC_API_KEY is not set
	translator StoryTranslator // nil when ANTHROPIC_API_KEY is not set
	now        func() time.Time
}

func NewStoryService(repo StoryRepository, gen StoryGenerator, translator StoryTranslator) *StoryService {
	return &StoryService{repo: repo, gen: gen, translator: translator, now: time.Now}
}

func (s *StoryService) today() string { return s.now().UTC().Format("2006-01-02") }

// TodayWords returns the words added today (used to enable the "generate" button).
func (s *StoryService) TodayWords(ctx context.Context, userID uuid.UUID) ([]domain.StoryWord, error) {
	return s.repo.WordsAddedOn(ctx, userID, s.today())
}

// GenerateDailyStory builds a story from today's words and resolves it for display in
// nativeLang. Returns (nil, nil) when no words were added today.
func (s *StoryService) GenerateDailyStory(ctx context.Context, userID uuid.UUID, genre, nativeLang string) (*domain.DailyStory, error) {
	st, err := s.generateFor(ctx, userID, s.today(), genre)
	if err != nil || st == nil {
		return st, err
	}
	s.resolveTranslation(ctx, st, nativeLang)
	return st, nil
}

// generateFor is the raw learning-language generation step, shared by the HTTP-facing
// GenerateDailyStory and the daily cron (generateForAll) — neither the cron nor this helper
// resolves a translation: nobody is viewing the story the moment the cron creates it.
func (s *StoryService) generateFor(ctx context.Context, userID uuid.UUID, day, genre string) (*domain.DailyStory, error) {
	if s.gen == nil {
		return nil, domain.ErrUnavailable
	}
	words, err := s.repo.WordsAddedOn(ctx, userID, day)
	if err != nil {
		return nil, err
	}
	if len(words) == 0 {
		return nil, nil
	}
	if len(words) > maxStoryWords {
		// Random sample, so every word gets a chance across regenerations.
		rand.Shuffle(len(words), func(i, j int) { words[i], words[j] = words[j], words[i] })
		words = words[:maxStoryWords]
	}
	genre = strings.TrimSpace(genre)
	if genre == "" {
		genre = StoryGenres[rand.Intn(len(StoryGenres))]
	}
	if len([]rune(genre)) > 50 {
		return nil, fmt.Errorf("%w: genre too long", domain.ErrValidation)
	}
	g, err := s.gen.GenerateStory(ctx, words, genre)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", domain.ErrUpstream, err)
	}
	saved, err := s.repo.Upsert(ctx, domain.DailyStory{
		UserID: userID, Date: day, Genre: genre, Title: g.Title,
		StoryDE: g.StoryDE, WordsUsed: words,
	})
	if err != nil {
		return nil, fmt.Errorf("save story: %w", err)
	}
	return &saved, nil
}

// ByDate returns a story for a given date (YYYY-MM-DD; empty means today), resolved for
// display in nativeLang.
func (s *StoryService) ByDate(ctx context.Context, userID uuid.UUID, day, nativeLang string) (*domain.DailyStory, error) {
	if day == "" {
		day = s.today()
	}
	if _, err := time.Parse("2006-01-02", day); err != nil {
		return nil, fmt.Errorf("%w: date must be YYYY-MM-DD", domain.ErrValidation)
	}
	st, err := s.repo.ByDate(ctx, userID, day)
	if err != nil {
		return nil, err
	}
	s.resolveTranslation(ctx, &st, nativeLang)
	return &st, nil
}

// resolveTranslation fills st.StoryTranslation and each WordsUsed[].Translation for nativeLang:
// a cached translation if one exists, generated via AI and cached otherwise. A cache miss with
// no translator configured, or a failed generation, just leaves the translation empty — the
// German text is still shown; it is never silently replaced with the wrong language.
func (s *StoryService) resolveTranslation(ctx context.Context, st *domain.DailyStory, nativeLang string) {
	nativeLang = domain.NormTranslationLang(nativeLang)
	st.Language = nativeLang
	// WordsUsed is stored with whatever language was active when the words were first added —
	// not necessarily nativeLang. Blank it out up front so a cache miss (or a failed AI call,
	// with no translator configured) leaves every gloss empty instead of silently showing that
	// stale, possibly-wrong-language value.
	for i := range st.WordsUsed {
		st.WordsUsed[i].Translation = ""
	}

	if tr, glosses, ok, err := s.repo.GetTranslation(ctx, st.ID, nativeLang); err == nil && ok {
		st.StoryTranslation = tr
		applyGlosses(st.WordsUsed, glosses)
		return
	} else if err != nil {
		slog.WarnContext(ctx, "story translation cache read failed", "story", st.ID, "err", err)
	}
	if s.translator == nil {
		return
	}

	words := make([]string, len(st.WordsUsed))
	for i, w := range st.WordsUsed {
		words[i] = w.Word
	}
	tr, glosses, err := s.translator.TranslateStory(ctx, domain.LangFrom(ctx), nativeLang, st.StoryDE, words)
	if err != nil {
		slog.WarnContext(ctx, "story translation failed", "story", st.ID, "lang", nativeLang, "err", err)
		return
	}
	if err := s.repo.PutTranslation(ctx, st.ID, nativeLang, tr, glosses); err != nil {
		slog.WarnContext(ctx, "story translation cache write failed", "story", st.ID, "err", err)
	}
	st.StoryTranslation = tr
	applyGlosses(st.WordsUsed, glosses)
}

// applyGlosses overwrites each word's Translation with its gloss for the currently requested
// native language (case-insensitive match on the word spelling).
func applyGlosses(words []domain.StoryWord, glosses map[string]string) {
	if len(glosses) == 0 {
		return
	}
	lower := make(map[string]string, len(glosses))
	for k, v := range glosses {
		lower[strings.ToLower(strings.TrimSpace(k))] = v
	}
	for i := range words {
		if g, ok := lower[strings.ToLower(strings.TrimSpace(words[i].Word))]; ok && g != "" {
			words[i].Translation = g
		}
	}
}

func (s *StoryService) List(ctx context.Context, userID uuid.UUID) ([]domain.DailyStory, error) {
	return s.repo.List(ctx, userID, 365)
}

// RunScheduler generates stories once a day at hour:00 (in loc) for every user who added
// words that day and has no story yet. Blocks until ctx is cancelled.
func (s *StoryService) RunScheduler(ctx context.Context, hour int, loc *time.Location) {
	if s.gen == nil {
		return
	}
	for {
		now := time.Now().In(loc)
		next := time.Date(now.Year(), now.Month(), now.Day(), hour, 0, 0, 0, loc)
		if !next.After(now) {
			next = next.Add(24 * time.Hour)
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(time.Until(next)):
		}
		s.generateForAll(ctx, next.UTC().Format("2006-01-02"))
	}
}

func (s *StoryService) generateForAll(ctx context.Context, day string) {
	users, err := s.repo.UsersWithWordsOn(ctx, day)
	if err != nil {
		slog.Error("daily story cron: list users", "err", err)
		return
	}
	slog.Info("daily story cron started", "date", day, "users", len(users))
	for _, uid := range users {
		// Up to 3 attempts per story inside the generator.
		c, cancel := context.WithTimeout(ctx, 7*time.Minute)
		lang, err := s.repo.LearningLanguage(c, uid)
		if err != nil {
			slog.Warn("daily story cron: learning language", "user", uid, "err", err)
			lang = domain.DefaultLearningLang
		}
		c = domain.WithLang(c, lang)
		// No translation here: nobody is viewing the story the moment the cron creates it —
		// resolveTranslation runs lazily the first time a user actually opens it.
		if _, err := s.generateFor(c, uid, day, ""); err != nil {
			slog.Warn("daily story cron: generation failed", "user", uid, "err", err)
		}
		cancel()
		if ctx.Err() != nil {
			return
		}
	}
}
