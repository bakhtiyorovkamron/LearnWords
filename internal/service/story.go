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

type StoryRepository interface {
	WordsAddedOn(ctx context.Context, userID uuid.UUID, day string) ([]domain.StoryWord, error)
	UsersWithWordsOn(ctx context.Context, day string) ([]uuid.UUID, error)
	// LearningLanguage is used by the cron job (no HTTP request → no language in ctx).
	LearningLanguage(ctx context.Context, userID uuid.UUID) (string, error)
	Upsert(ctx context.Context, s domain.DailyStory) (domain.DailyStory, error)
	ByDate(ctx context.Context, userID uuid.UUID, day string) (domain.DailyStory, error)
	List(ctx context.Context, userID uuid.UUID, limit int) ([]domain.DailyStory, error)
}

var StoryGenres = []string{"приключение", "детектив", "комедия", "сказка", "фантастика", "повседневная жизнь", "романтика"}

// maxStoryWords caps how many of the day's words go into one story: long word lists make the
// answer huge (DE + RU text) and much more likely to be cut off or malformed.
const maxStoryWords = 12

type StoryService struct {
	repo StoryRepository
	gen  StoryGenerator // nil when ANTHROPIC_API_KEY is not set
	now  func() time.Time
}

func NewStoryService(repo StoryRepository, gen StoryGenerator) *StoryService {
	return &StoryService{repo: repo, gen: gen, now: time.Now}
}

func (s *StoryService) today() string { return s.now().UTC().Format("2006-01-02") }

// TodayWords returns the words added today (used to enable the "generate" button).
func (s *StoryService) TodayWords(ctx context.Context, userID uuid.UUID) ([]domain.StoryWord, error) {
	return s.repo.WordsAddedOn(ctx, userID, s.today())
}

// GenerateDailyStory builds a story from today's words. Returns (nil, nil) when no words were added today.
func (s *StoryService) GenerateDailyStory(ctx context.Context, userID uuid.UUID, genre string) (*domain.DailyStory, error) {
	return s.generateFor(ctx, userID, s.today(), genre)
}

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
		StoryDE: g.StoryDE, StoryRU: g.StoryRU, WordsUsed: words,
	})
	if err != nil {
		return nil, fmt.Errorf("save story: %w", err)
	}
	return &saved, nil
}

// ByDate returns a story for a given date (YYYY-MM-DD); empty means today.
func (s *StoryService) ByDate(ctx context.Context, userID uuid.UUID, day string) (*domain.DailyStory, error) {
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
	return &st, nil
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
		if _, err := s.generateFor(c, uid, day, ""); err != nil {
			slog.Warn("daily story cron: generation failed", "user", uid, "err", err)
		}
		cancel()
		if ctx.Err() != nil {
			return
		}
	}
}
