package service

import (
	"context"
	"math/rand"
	"strings"
	"time"

	"github.com/google/uuid"

	"learnwords/internal/domain"
)

// HeroMinBox: a word counts as "learned" for the hero feature once it reaches this Leitner
// box (4 or 5) — kept as a named constant so the threshold is easy to change later.
const HeroMinBox = 4

// heroStageMinCount[i] is the learned-word count at which stage i+1 begins (stage 1 starts at 0).
// Stage 6 ("от 2400") has no upper bound.
var heroStageMinCount = [6]int{0, 50, 200, 500, 1300, 2400}

// heroStageFor returns the stage (1-6) for a raw learned-word count.
func heroStageFor(learnedCount int) int {
	stage := 1
	for i, min := range heroStageMinCount {
		if learnedCount >= min {
			stage = i + 1
		}
	}
	return stage
}

// heroWordsToNextStage: how many more learned words until stage grows past its current value;
// 0 at the max stage.
func heroWordsToNextStage(learnedCount, stage int) int {
	if stage >= len(heroStageMinCount) {
		return 0
	}
	next := heroStageMinCount[stage] // stage is 1-indexed, so index `stage` is the NEXT threshold
	if next <= learnedCount {
		return 0
	}
	return next - learnedCount
}

// heroTimezone: birthdays are evaluated in Asia/Tashkent regardless of where the server runs.
const heroTimezone = "Asia/Tashkent"

// isHeroBirthday reports whether `now` is an anniversary (1+ years later, same month and day)
// of bornAt, in heroTimezone. years is meaningless when isToday is false.
func isHeroBirthday(bornAt, now time.Time) (isToday bool, years int) {
	loc, err := time.LoadLocation(heroTimezone)
	if err != nil {
		loc = time.UTC
	}
	b, n := bornAt.In(loc), now.In(loc)
	if b.Month() != n.Month() || b.Day() != n.Day() {
		return false, 0
	}
	years = n.Year() - b.Year()
	return years >= 1, years
}

// HeroRepository is the storage side of the hero feature — see postgres.HeroRepository.
type HeroRepository interface {
	CountLearned(ctx context.Context, userID uuid.UUID, minBox int) (int, error)
	LearnedWords(ctx context.Context, userID uuid.UUID, minBox int) ([]string, error)
	HeroStage(ctx context.Context, userID uuid.UUID) (stage int, ok bool, err error)
	SetHeroStage(ctx context.Context, userID uuid.UUID, stage int) error
}

type HeroService struct {
	users   UserRepository
	repo    HeroRepository
	allowed map[string]bool // lowercased emails from FEATURE_HERO_EMAILS
	now     func() time.Time
	pick    func(n int) int // injected for deterministic tests; production uses rand.Intn
}

// NewHeroService builds the service. allowedEmails comes straight from the
// FEATURE_HERO_EMAILS env var (comma-separated) — never hardcoded, compared case-insensitively.
func NewHeroService(users UserRepository, repo HeroRepository, allowedEmails []string) *HeroService {
	allowed := make(map[string]bool, len(allowedEmails))
	for _, e := range allowedEmails {
		if e = strings.ToLower(strings.TrimSpace(e)); e != "" {
			allowed[e] = true
		}
	}
	return &HeroService{users: users, repo: repo, allowed: allowed, now: time.Now, pick: rand.Intn}
}

// Get builds the hero card for userID in the given interface language. Returns
// domain.ErrNotFound (→ 404) when the feature isn't available to this user at all: not on the
// FEATURE_HERO_EMAILS allowlist, or the account isn't learning German — the frontend must see
// no difference between "not allowed" and "no such endpoint", and the email never reaches the
// client either way.
func (s *HeroService) Get(ctx context.Context, userID uuid.UUID, interfaceLang string) (*domain.Hero, error) {
	user, err := s.users.GetByID(ctx, userID)
	if err != nil {
		return nil, err
	}
	if !s.allowed[strings.ToLower(user.Email)] || user.LearningLanguage != domain.DefaultLearningLang {
		return nil, domain.ErrNotFound
	}

	learnedCount, err := s.repo.CountLearned(ctx, userID, HeroMinBox)
	if err != nil {
		return nil, err
	}
	rawStage := heroStageFor(learnedCount)

	prevStage, hadPrev, err := s.repo.HeroStage(ctx, userID)
	if err != nil {
		return nil, err
	}
	stage := rawStage
	stageChanged := false
	if hadPrev {
		stageChanged = rawStage > prevStage
		if prevStage > stage {
			stage = prevStage // the hero only ever grows forward
		}
	}
	if !hadPrev || stage != prevStage {
		if err := s.repo.SetHeroStage(ctx, userID, stage); err != nil {
			return nil, err
		}
	}

	words, err := s.repo.LearnedWords(ctx, userID, HeroMinBox)
	if err != nil {
		return nil, err
	}
	phrase := heroPhrase(stage, words, s.pick)

	now := s.now()
	birthdayToday, years := isHeroBirthday(user.CreatedAt, now)
	switch {
	case birthdayToday:
		phrase = heroBirthdayPhrase(years)
	case stageChanged:
		phrase = heroGrowthPhrase
	}

	return &domain.Hero{
		Stage:            stage,
		StageName:        heroStageName(stage, interfaceLang),
		LearnedCount:     learnedCount,
		WordsToNextStage: heroWordsToNextStage(learnedCount, stage),
		BornAt:           user.CreatedAt,
		AgeDays:          int(now.Sub(user.CreatedAt).Hours() / 24),
		BirthdayToday:    birthdayToday,
		Phrase:           phrase,
		StageChanged:     stageChanged,
	}, nil
}
