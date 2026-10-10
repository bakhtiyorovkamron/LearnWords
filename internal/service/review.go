package service

import (
	"context"
	"time"

	"github.com/google/uuid"

	"learnwords/internal/domain"
)

const (
	maxBox        = 5
	learnedStreak = 2
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

type ReviewRepository interface {
	ListDue(ctx context.Context, userID uuid.UUID, today time.Time, limit int, folder *domain.FolderFilter) ([]domain.DueCard, error)
	// CountDue is the real total, ignoring the session-size cap (for the "N words due today" line).
	CountDue(ctx context.Context, userID uuid.UUID, today time.Time, folder *domain.FolderFilter) (int, error)
	// Apply runs fn on the current progress inside a transaction, stores the result and logs the answer.
	Apply(ctx context.Context, userID, wordID uuid.UUID, today time.Time, correct bool,
		fn func(p domain.Progress) domain.Progress) (*domain.Progress, error)
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

// ApplyAnswer is the pure Leitner transition.
func ApplyAnswer(p domain.Progress, correct bool, now time.Time) domain.Progress {
	today := dateOf(now)
	if correct {
		if p.BoxLevel < maxBox {
			p.BoxLevel++
		} else {
			p.CorrectStreakAtMax++
			if p.CorrectStreakAtMax >= learnedStreak {
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
