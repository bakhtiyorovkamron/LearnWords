package service

import (
	"context"
	"time"

	"github.com/google/uuid"

	"learnwords/internal/domain"
)

const (
	// DefaultSessionSize is used whenever the requested session size is missing or invalid.
	DefaultSessionSize = 20
	// unlimitedSessionSize stands in for "all" as a SQL LIMIT — effectively no cap at all.
	unlimitedSessionSize = 1 << 30
)

// boxIntervalDays: days until next review for each box level.
var boxIntervalDays = map[int]int{1: 1, 2: 2, 3: 4, 4: 7, 5: 14}

// NormalizeSessionSize validates the requested training-session size (10, 20, 50 or "all")
// and returns the SQL LIMIT to use; anything else falls back to DefaultSessionSize.
func NormalizeSessionSize(s string) int {
	switch s {
	case "10":
		return 10
	case "20":
		return 20
	case "50":
		return 50
	case "all":
		return unlimitedSessionSize
	default:
		return DefaultSessionSize
	}
}

// DefaultPracticeMode is used whenever the requested practice mode is missing or invalid.
const DefaultPracticeMode = "hard"

var practiceModes = map[string]bool{"hard": true, "random": true, "recent": true}

// NormalizePracticeMode validates the requested practice word-selection mode
// ("hard" | "random" | "recent"); anything else falls back to DefaultPracticeMode.
func NormalizePracticeMode(m string) string {
	if practiceModes[m] {
		return m
	}
	return DefaultPracticeMode
}

type ReviewRepository interface {
	ListDue(ctx context.Context, userID uuid.UUID, today time.Time, limit int, folder *domain.FolderFilter) ([]domain.DueCard, error)
	// CountDue is the real total, ignoring the session-size cap (for the "N words due today" line).
	CountDue(ctx context.Context, userID uuid.UUID, today time.Time, folder *domain.FolderFilter) (int, error)
	// Apply runs fn on the current progress inside a transaction, stores the result and logs the answer.
	Apply(ctx context.Context, userID, wordID uuid.UUID, today time.Time, correct bool,
		fn func(p domain.Progress) domain.Progress) (*domain.Progress, error)
	// PracticeWords draws a pool for extra practice from the WHOLE collection (not just due
	// words) — practice exists precisely so there's something to do when nothing is due.
	PracticeWords(ctx context.Context, userID uuid.UUID, mode string, limit int, folder *domain.FolderFilter) ([]domain.DueCard, error)
	// LogPractice records a practice answer for streak/activity purposes only. It must never
	// update word_progress — see postgres.ReviewRepository.LogPractice's implementation.
	LogPractice(ctx context.Context, userID, wordID uuid.UUID, correct bool) error
}

type ReviewService struct {
	repo ReviewRepository
	now  func() time.Time
}

func NewReviewService(repo ReviewRepository) *ReviewService {
	return &ReviewService{repo: repo, now: time.Now}
}

func dateOf(t time.Time) time.Time {
	y, m, d := t.Date()
	return time.Date(y, m, d, 0, 0, 0, 0, time.UTC)
}

// Due returns up to NormalizeSessionSize(sessionSize) words that should be reviewed today
// (optionally only from one folder), in priority order — see ListDue — plus the real total due
// count (uncapped), so the caller can show "N due today, M in this session".
func (s *ReviewService) Due(ctx context.Context, userID uuid.UUID, folder *domain.FolderFilter, sessionSize string) ([]domain.DueCard, int, error) {
	today := dateOf(s.now())
	total, err := s.repo.CountDue(ctx, userID, today, folder)
	if err != nil {
		return nil, 0, err
	}
	cards, err := s.repo.ListDue(ctx, userID, today, NormalizeSessionSize(sessionSize), folder)
	if err != nil {
		return nil, 0, err
	}
	return cards, total, nil
}

// Answer applies the user's answer to the word's Leitner state.
func (s *ReviewService) Answer(ctx context.Context, userID, wordID uuid.UUID, correct bool) (*domain.Progress, error) {
	now := s.now()
	today := dateOf(now)
	return s.repo.Apply(ctx, userID, wordID, today, correct, func(p domain.Progress) domain.Progress {
		return ApplyAnswer(p, correct, now)
	})
}

// Practice returns up to NormalizeSessionSize(sessionSize) words for EXTRA practice — drawn
// from the whole collection, not limited to what's due today — ordered per
// NormalizePracticeMode(mode) (hardest first / random / most recently added).
func (s *ReviewService) Practice(ctx context.Context, userID uuid.UUID, mode, sessionSize string, folder *domain.FolderFilter) ([]domain.DueCard, error) {
	return s.repo.PracticeWords(ctx, userID, NormalizePracticeMode(mode), NormalizeSessionSize(sessionSize), folder)
}

// AnswerPractice logs a practice answer for the daily-activity streak only. It deliberately
// does NOT call Apply/ApplyAnswer — practice must never change a word's box, next review date,
// or learned status. This is enforced here structurally (there is no Leitner-mutating code in
// this method at all), not by trusting a client-sent flag.
func (s *ReviewService) AnswerPractice(ctx context.Context, userID, wordID uuid.UUID, correct bool) error {
	return s.repo.LogPractice(ctx, userID, wordID, correct)
}

// ApplyAnswer is the pure Leitner transition.
func ApplyAnswer(p domain.Progress, correct bool, now time.Time) domain.Progress {
	today := dateOf(now)
	if correct {
		if p.BoxLevel < domain.LearnedMinBox {
			p.BoxLevel++
		} else {
			p.CorrectStreakAtMax++
			if p.CorrectStreakAtMax >= domain.LearnedStreak {
				p.IsLearned = true
			}
		}
		p.NextReviewAt = today.AddDate(0, 0, boxIntervalDays[p.BoxLevel])
	} else {
		p.BoxLevel = 1
		p.CorrectStreakAtMax = 0
		p.IsLearned = false
		p.NextReviewAt = today.AddDate(0, 0, 1)
	}
	p.LastReviewedAt = &now
	return p
}
