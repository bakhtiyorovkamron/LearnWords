package service

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"

	"learnwords/internal/domain"
)

type StatsRepository interface {
	Daily(ctx context.Context, userID uuid.UUID, from, to time.Time) ([]domain.DayStat, error)
	LearnedCount(ctx context.Context, userID uuid.UUID) (int, error)
	ActiveDays(ctx context.Context, userID uuid.UUID) ([]time.Time, error)
}

type StatsService struct {
	repo StatsRepository
	now  func() time.Time
}

func NewStatsService(repo StatsRepository) *StatsService {
	return &StatsService{repo: repo, now: time.Now}
}

var statsPeriodDays = map[string]int{"week": 7, "month": 30}

// Get returns per-day activity for the period plus totals.
func (s *StatsService) Get(ctx context.Context, userID uuid.UUID, period string) (*domain.Stats, error) {
	days, ok := statsPeriodDays[period]
	if !ok {
		return nil, fmt.Errorf("%w: period must be week or month", domain.ErrValidation)
	}
	today := dateOf(s.now())
	from := today.AddDate(0, 0, -(days - 1))

	daily, err := s.repo.Daily(ctx, userID, from, today)
	if err != nil {
		return nil, err
	}
	learned, err := s.repo.LearnedCount(ctx, userID)
	if err != nil {
		return nil, err
	}
	active, err := s.repo.ActiveDays(ctx, userID)
	if err != nil {
		return nil, err
	}

	var reviewed, correct int
	for _, d := range daily {
		reviewed += d.Reviewed
		correct += d.Correct
	}
	accuracy := 0
	if reviewed > 0 {
		accuracy = int(float64(correct)/float64(reviewed)*100 + 0.5)
	}
	current, longest := Streaks(active, today)

	return &domain.Stats{
		Daily: daily,
		Totals: domain.StatsTotals{
			TotalWordsLearned: learned,
			CurrentStreakDays: current,
			LongestStreakDays: longest,
			AccuracyPercent:   accuracy,
		},
	}, nil
}

// Streaks computes the current and longest run of consecutive active days.
// days must be distinct and sorted newest first. The current streak counts only if
// the latest active day is today or yesterday.
func Streaks(days []time.Time, today time.Time) (current, longest int) {
	today = dateOf(today)
	run := 0
	for i, d := range days {
		if i > 0 && dateOf(days[i-1]).AddDate(0, 0, -1).Equal(dateOf(d)) {
			run++
		} else {
			run = 1
		}
		if run > longest {
			longest = run
		}
	}
	if len(days) == 0 {
		return 0, 0
	}
	first := dateOf(days[0])
	if first.Equal(today) || first.Equal(today.AddDate(0, 0, -1)) {
		current = 1
		for i := 1; i < len(days); i++ {
			if dateOf(days[i-1]).AddDate(0, 0, -1).Equal(dateOf(days[i])) {
				current++
			} else {
				break
			}
		}
	}
	return current, longest
}
