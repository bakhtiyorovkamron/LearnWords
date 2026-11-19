package service

import (
	"context"
	"time"

	"github.com/google/uuid"
)

// RepeatRepository stores the deck's "review later" marks (postgres.ReviewRepository).
type RepeatRepository interface {
	// MarkRepeat makes the word due `today` (its box untouched) and remembers what that changed;
	// a word already marked stays as it is.
	MarkRepeat(ctx context.Context, userID, wordID uuid.UUID, today time.Time) error
	// UnmarkRepeat puts back what marking changed and removes the mark; no mark → nothing changes.
	UnmarkRepeat(ctx context.Context, userID, wordID uuid.UUID) error
}

// RepeatService backs the "review later" mark on the cards deck. A marked word is due today, so
// every "due today" query (training, Home, folders, hero, Telegram reminders) takes it as it is;
// its first review answer clears the mark (ReviewRepository.Apply), a practice answer does not.
type RepeatService struct {
	repo RepeatRepository
	now  func() time.Time
}

func NewRepeatService(repo RepeatRepository) *RepeatService {
	return &RepeatService{repo: repo, now: time.Now}
}

// SetRepeat marks (marked = true) or unmarks the word and returns the new state. "Today" is the same
// UTC day ReviewService uses. Another user's word → domain.ErrNotFound.
func (s *RepeatService) SetRepeat(ctx context.Context, userID, wordID uuid.UUID, marked bool) (bool, error) {
	if marked {
		if err := s.repo.MarkRepeat(ctx, userID, wordID, dateOf(s.now())); err != nil {
			return false, err
		}
		return true, nil
	}
	if err := s.repo.UnmarkRepeat(ctx, userID, wordID); err != nil {
		return false, err
	}
	return false, nil
}
