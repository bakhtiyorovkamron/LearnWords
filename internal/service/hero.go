package service

import (
	"context"
	"math/rand"
	"time"

	"github.com/google/uuid"

	"learnwords/internal/domain"
)

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
// CountLearned/LearnedWords use the SAME definition of "learned" as the stats page and the
// Collection filter (domain.LearnedMinBox / word_progress.is_learned) — see domain/learned.go.
type HeroRepository interface {
	CountLearned(ctx context.Context, userID uuid.UUID) (int, error)
	CountAlmostLearned(ctx context.Context, userID uuid.UUID, box int) (int, error)
	// LearnedWords: every learned German word with its grammar and translation into lang.
	LearnedWords(ctx context.Context, userID uuid.UUID, lang string) ([]domain.HeroWord, error)
	HeroStage(ctx context.Context, userID uuid.UUID) (stage int, ok bool, err error)
	SetHeroStage(ctx context.Context, userID uuid.UUID, stage int) error
	// StageSeen: the highest stage whose congratulation was shown; ok=false if never set.
	StageSeen(ctx context.Context, userID uuid.UUID) (stage int, ok bool, err error)
	SetStageSeen(ctx context.Context, userID uuid.UUID, stage int) error
	// IntroSeen: the one-time "Meet your German hero!" screen was shown.
	IntroSeen(ctx context.Context, userID uuid.UUID) (bool, error)
	SetIntroSeen(ctx context.Context, userID uuid.UUID) error
	// CountDueToday: words due for review today (same rule as the review queue).
	CountDueToday(ctx context.Context, userID uuid.UUID, today time.Time) (int, error)
	// ActiveDaysSince: distinct UTC days with at least one answer (review or practice) since from.
	ActiveDaysSince(ctx context.Context, userID uuid.UUID, from time.Time) ([]time.Time, error)
}

type HeroService struct {
	users   UserRepository
	repo    HeroRepository
	enabled bool // FEATURE_HERO_ENABLED
	now     func() time.Time
	pick    func(n int) int // injected for deterministic tests; production uses rand.Intn
}

// NewHeroService builds the service. enabled is the FEATURE_HERO_ENABLED switch.
func NewHeroService(users UserRepository, repo HeroRepository, enabled bool) *HeroService {
	return &HeroService{users: users, repo: repo, enabled: enabled, now: time.Now, pick: rand.Intn}
}

// available returns domain.ErrNotFound (→ 404) when the hero isn't there for this user: the
// feature is switched off, or the account isn't learning German. The frontend treats the 404 as
// "no hero" and shows nothing.
func (s *HeroService) available(ctx context.Context, userID uuid.UUID) (*domain.User, error) {
	if !s.enabled {
		return nil, domain.ErrNotFound
	}
	user, err := s.users.GetByID(ctx, userID)
	if err != nil {
		return nil, err
	}
	if user.LearningLanguage != domain.DefaultLearningLang {
		return nil, domain.ErrNotFound
	}
	return user, nil
}

// heroMood decides the hero's mood of the day. activeDays are the days with any training;
// today is a UTC date (midnight).
//   - trained today: happy if nothing is due any more, otherwise idle;
//   - not trained today: sad on the first day after the streak broke (yesterday missed, the day
//     before active), else sleepy if words are due, else idle.
func heroMood(dueToday int, activeDays []time.Time, today time.Time) string {
	active := make(map[string]bool, len(activeDays))
	for _, d := range activeDays {
		active[d.UTC().Format("2006-01-02")] = true
	}
	day := func(offset int) bool { return active[today.AddDate(0, 0, offset).Format("2006-01-02")] }
	switch {
	case day(0) && dueToday == 0:
		return domain.HeroHappy
	case day(0):
		return domain.HeroIdle
	case !day(-1) && day(-2):
		return domain.HeroSad
	case dueToday > 0:
		return domain.HeroSleepy
	default:
		return domain.HeroIdle
	}
}

// Get builds the hero card for userID in the given interface language.
func (s *HeroService) Get(ctx context.Context, userID uuid.UUID, interfaceLang string) (*domain.Hero, error) {
	user, err := s.available(ctx, userID)
	if err != nil {
		return nil, err
	}
	interfaceLang = domain.NormTranslationLang(interfaceLang)

	learnedCount, err := s.repo.CountLearned(ctx, userID)
	if err != nil {
		return nil, err
	}
	// "Almost learned" is a display-only number — it must never feed into the stage, which is
	// computed from learnedCount alone.
	almostCount, err := s.repo.CountAlmostLearned(ctx, userID, domain.LearnedMinBox-1)
	if err != nil {
		return nil, err
	}

	// The hero only ever grows forward.
	stage := heroStageFor(learnedCount)
	prevStage, hadPrev, err := s.repo.HeroStage(ctx, userID)
	if err != nil {
		return nil, err
	}
	if hadPrev && prevStage > stage {
		stage = prevStage
	}
	if !hadPrev || stage != prevStage {
		if err := s.repo.SetHeroStage(ctx, userID, stage); err != nil {
			return nil, err
		}
	}
	// stage_up stays true until the congratulation is marked as seen. The very first stage a
	// hero is computed at is not "growth" — it counts as seen right away (so an existing user
	// with words gets the one-time intro below instead of a "your hero grew up" screen).
	seen, hadSeen, err := s.repo.StageSeen(ctx, userID)
	if err != nil {
		return nil, err
	}
	if !hadSeen {
		seen = stage
		if hadPrev {
			seen = prevStage
		}
		if err := s.repo.SetStageSeen(ctx, userID, seen); err != nil {
			return nil, err
		}
	}
	stageUp := stage > seen
	introSeen, err := s.repo.IntroSeen(ctx, userID)
	if err != nil {
		return nil, err
	}

	now := s.now()
	today := dateOf(now)
	due, err := s.repo.CountDueToday(ctx, userID, today)
	if err != nil {
		return nil, err
	}
	days, err := s.repo.ActiveDaysSince(ctx, userID, today.AddDate(0, 0, -2))
	if err != nil {
		return nil, err
	}

	words, err := s.repo.LearnedWords(ctx, userID, interfaceLang)
	if err != nil {
		return nil, err
	}
	phrase := heroPhrase(stage, words, interfaceLang, s.pick)
	birthdayToday, years := isHeroBirthday(user.CreatedAt, now)
	switch {
	case birthdayToday:
		phrase = heroBirthdayLine(years).phrase(interfaceLang)
	case stageUp:
		phrase = heroGrowthLine.phrase(interfaceLang)
	}

	return &domain.Hero{
		Stage:            stage,
		StageName:        heroStageName(stage, interfaceLang),
		LearnedCount:     learnedCount,
		AlmostCount:      almostCount,
		WordsToNextStage: heroWordsToNextStage(learnedCount, stage),
		BornAt:           user.CreatedAt,
		AgeDays:          int(now.Sub(user.CreatedAt).Hours() / 24),
		BirthdayToday:    birthdayToday,
		Mood:             heroMood(due, days, today),
		Phrase:           phrase,
		StageUp:          stageUp,
		Intro:            !introSeen,
	}, nil
}

// MarkStageSeen handles POST /api/hero/stage-seen: the congratulation for the current stage
// was shown, so stage_up turns false until the hero grows again.
func (s *HeroService) MarkStageSeen(ctx context.Context, userID uuid.UUID) error {
	if _, err := s.available(ctx, userID); err != nil {
		return err
	}
	stage, ok, err := s.repo.HeroStage(ctx, userID)
	if err != nil || !ok {
		return err
	}
	return s.repo.SetStageSeen(ctx, userID, stage)
}

// MarkIntroSeen handles POST /api/hero/intro-seen: the one-time introduction was shown.
func (s *HeroService) MarkIntroSeen(ctx context.Context, userID uuid.UUID) error {
	if _, err := s.available(ctx, userID); err != nil {
		return err
	}
	return s.repo.SetIntroSeen(ctx, userID)
}
