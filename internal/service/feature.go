package service

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"

	"learnwords/internal/domain"
)

type FeatureRepository interface {
	Overrides(ctx context.Context, userID uuid.UUID) (map[string]domain.FeatureOverride, error)
	Usage(ctx context.Context, userID uuid.UUID, day string) (map[string]int, error)
	// Consume adds n atomically unless the day's total would exceed limit (ok=false, nothing changed).
	Consume(ctx context.Context, userID uuid.UUID, feature, day string, n, limit int) (count int, ok bool, err error)
	Refund(ctx context.Context, userID uuid.UUID, feature, day string, n int) error
	SetOverride(ctx context.Context, userID uuid.UUID, feature string, enabled bool, dailyLimit *int) error
}

// FeatureService decides what a user may do: per-user on/off switches and daily limits.
type FeatureService struct {
	repo FeatureRepository
	now  func() time.Time
}

// FeatureOption customizes a FeatureService.
type FeatureOption func(*FeatureService)

// WithFeatureClock replaces the clock (tests).
func WithFeatureClock(now func() time.Time) FeatureOption {
	return func(s *FeatureService) { s.now = now }
}

func NewFeatureService(repo FeatureRepository, opts ...FeatureOption) *FeatureService {
	s := &FeatureService{repo: repo, now: time.Now}
	for _, o := range opts {
		o(s)
	}
	return s
}

func (s *FeatureService) day() string { return domain.FeatureDay(s.now()) }

func buildState(spec domain.FeatureSpec, ov map[string]domain.FeatureOverride, usage map[string]int) domain.FeatureState {
	st := domain.FeatureState{Feature: spec.Name, Enabled: true, DefaultLimit: spec.DefaultLimit, DailyLimit: spec.DefaultLimit, UsedToday: usage[spec.Name]}
	if o, ok := ov[spec.Name]; ok {
		st.Enabled = o.Enabled
		if o.DailyLimit != nil {
			st.LimitOverride = o.DailyLimit
			st.DailyLimit = o.DailyLimit
		}
	}
	if st.DailyLimit != nil {
		rem := max(*st.DailyLimit-st.UsedToday, 0)
		st.Remaining = &rem
	}
	return st
}

// States returns every catalog feature merged with the user's overrides and today's usage.
func (s *FeatureService) States(ctx context.Context, userID uuid.UUID) ([]domain.FeatureState, error) {
	ov, err := s.repo.Overrides(ctx, userID)
	if err != nil {
		return nil, err
	}
	usage, err := s.repo.Usage(ctx, userID, s.day())
	if err != nil {
		return nil, err
	}
	out := make([]domain.FeatureState, 0, len(domain.FeatureCatalog))
	for _, spec := range domain.FeatureCatalog {
		out = append(out, buildState(spec, ov, usage))
	}
	return out, nil
}

// State returns one feature's state; an unknown feature is ErrValidation.
func (s *FeatureService) State(ctx context.Context, userID uuid.UUID, feature string) (domain.FeatureState, error) {
	if !domain.IsFeature(feature) {
		return domain.FeatureState{}, fmt.Errorf("%w: unknown feature", domain.ErrValidation)
	}
	states, err := s.States(ctx, userID)
	if err != nil {
		return domain.FeatureState{}, err
	}
	for _, st := range states {
		if st.Feature == feature {
			return st, nil
		}
	}
	return domain.FeatureState{}, domain.ErrNotFound
}

// effective returns whether the feature is on and its limit (nil = unlimited).
func (s *FeatureService) effective(ctx context.Context, userID uuid.UUID, feature string) (limit *int, err error) {
	spec, ok := domain.FeatureByName(feature)
	if !ok {
		return nil, fmt.Errorf("%w: unknown feature", domain.ErrValidation)
	}
	ov, err := s.repo.Overrides(ctx, userID)
	if err != nil {
		return nil, err
	}
	limit = spec.DefaultLimit
	if o, ok := ov[feature]; ok {
		if !o.Enabled {
			return nil, domain.ErrFeatureDisabled
		}
		if o.DailyLimit != nil {
			limit = o.DailyLimit
		}
	}
	return limit, nil
}

// Require: ErrFeatureDisabled when the admin switched the feature off for this user.
func (s *FeatureService) Require(ctx context.Context, userID uuid.UUID, feature string) error {
	_, err := s.effective(ctx, userID, feature)
	return err
}

// Consume uses n units of today's quota atomically. nil remaining = the feature has no limit
// (nothing is recorded). Over the limit → ErrDailyLimit (carrying the limit), nothing is charged.
func (s *FeatureService) Consume(ctx context.Context, userID uuid.UUID, feature string, n int) (*int, error) {
	if n <= 0 {
		return nil, fmt.Errorf("%w: n must be positive", domain.ErrValidation)
	}
	limit, err := s.effective(ctx, userID, feature)
	if err != nil || limit == nil {
		return nil, err
	}
	count, ok, err := s.repo.Consume(ctx, userID, feature, s.day(), n, *limit)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, &domain.DailyLimitError{Limit: *limit}
	}
	rem := *limit - count
	return &rem, nil
}

// Refund gives n units back (a failed AI call must not cost the user quota). Never below 0.
func (s *FeatureService) Refund(ctx context.Context, userID uuid.UUID, feature string, n int) error {
	if n <= 0 || !domain.IsFeature(feature) {
		return nil
	}
	return s.repo.Refund(ctx, userID, feature, s.day(), n)
}

// Set stores the admin override; dailyLimit nil = use the default limit.
func (s *FeatureService) Set(ctx context.Context, userID uuid.UUID, feature string, enabled bool, dailyLimit *int) error {
	if !domain.IsFeature(feature) {
		return fmt.Errorf("%w: unknown feature", domain.ErrValidation)
	}
	if dailyLimit != nil && *dailyLimit < 0 {
		return fmt.Errorf("%w: daily_limit must be >= 0", domain.ErrValidation)
	}
	return s.repo.SetOverride(ctx, userID, feature, enabled, dailyLimit)
}
