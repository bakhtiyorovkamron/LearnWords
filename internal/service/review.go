package service

import (
	"context"
	"time"

	"github.com/google/uuid"

	"learnwords/internal/domain"
)

const (
	maxBox          = 5
	learnedStreak   = 2
	defaultDueLimit = 100
)

// boxIntervalDays: days until next review for each box level.
var boxIntervalDays = map[int]int{1: 1, 2: 2, 3: 4, 4: 7, 5: 14}

type ReviewRepository interface {
	ListDue(ctx context.Context, userID uuid.UUID, today time.Time, limit int) ([]domain.DueCard, error)
	// Apply runs fn on the current progress inside a transaction and stores the result.
	Apply(ctx context.Context, userID, wordID uuid.UUID, today time.Time,
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

// Due returns words that should be reviewed today.
func (s *ReviewService) Due(ctx context.Context, userID uuid.UUID) ([]domain.DueCard, error) {
	return s.repo.ListDue(ctx, userID, dateOf(s.now()), defaultDueLimit)
}

// Answer applies the user's answer to the word's Leitner state.
func (s *ReviewService) Answer(ctx context.Context, userID, wordID uuid.UUID, correct bool) (*domain.Progress, error) {
	now := s.now()
	today := dateOf(now)
	return s.repo.Apply(ctx, userID, wordID, today, func(p domain.Progress) domain.Progress {
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
