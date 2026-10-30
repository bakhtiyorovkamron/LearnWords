package service

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	"learnwords/internal/domain"
)

// memFeatureRepo is an in-memory FeatureRepository (the Postgres one is tested separately).
type memFeatureRepo struct {
	mu    sync.Mutex
	ov    map[string]domain.FeatureOverride
	usage map[string]int // feature|day
}

func newMemFeatureRepo() *memFeatureRepo {
	return &memFeatureRepo{ov: map[string]domain.FeatureOverride{}, usage: map[string]int{}}
}

func (r *memFeatureRepo) Overrides(context.Context, uuid.UUID) (map[string]domain.FeatureOverride, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := map[string]domain.FeatureOverride{}
	for k, v := range r.ov {
		out[k] = v
	}
	return out, nil
}

func (r *memFeatureRepo) Usage(_ context.Context, _ uuid.UUID, day string) (map[string]int, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := map[string]int{}
	for _, spec := range domain.FeatureCatalog {
		if n, ok := r.usage[spec.Name+"|"+day]; ok {
			out[spec.Name] = n
		}
	}
	return out, nil
}

func (r *memFeatureRepo) Consume(_ context.Context, _ uuid.UUID, feature, day string, n, limit int) (int, bool, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	k := feature + "|" + day
	if r.usage[k]+n > limit {
		return 0, false, nil
	}
	r.usage[k] += n
	return r.usage[k], true, nil
}

func (r *memFeatureRepo) Refund(_ context.Context, _ uuid.UUID, feature, day string, n int) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	k := feature + "|" + day
	r.usage[k] = max(r.usage[k]-n, 0)
	return nil
}

func (r *memFeatureRepo) SetOverride(_ context.Context, _ uuid.UUID, feature string, enabled bool, limit *int) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.ov[feature] = domain.FeatureOverride{Enabled: enabled, DailyLimit: limit}
	return nil
}

func ip(n int) *int { return &n }

// defaultPhotoLimit mirrors the catalog default of photo_import.
const defaultPhotoLimit = 10

func TestFeatures_DefaultsWithoutOverrides(t *testing.T) {
	s := NewFeatureService(newMemFeatureRepo())
	states, err := s.States(context.Background(), uuid.New())
	if err != nil {
		t.Fatal(err)
	}
	if len(states) != 4 || states[0].Feature != domain.FeaturePhotoImport || states[3].Feature != domain.FeatureStoryAutotranslate {
		t.Fatalf("catalog order: %+v", states)
	}
	p := states[0]
	if !p.Enabled || p.DailyLimit == nil || *p.DailyLimit != defaultPhotoLimit || *p.DefaultLimit != defaultPhotoLimit || p.LimitOverride != nil || *p.Remaining != defaultPhotoLimit {
		t.Errorf("photo_import: %+v", p)
	}
	for _, st := range states[1:] {
		if !st.Enabled || st.DailyLimit != nil || st.Remaining != nil {
			t.Errorf("%s must be on and unlimited: %+v", st.Feature, st)
		}
	}
}

func TestFeatures_OverrideDisablesAndChangesLimit(t *testing.T) {
	ctx, u := context.Background(), uuid.New()
	s := NewFeatureService(newMemFeatureRepo())

	if err := s.Set(ctx, u, domain.FeatureDailyStory, false, nil); err != nil {
		t.Fatal(err)
	}
	if err := s.Require(ctx, u, domain.FeatureDailyStory); !errors.Is(err, domain.ErrFeatureDisabled) {
		t.Errorf("Require on a disabled feature: %v", err)
	}
	if _, err := s.Consume(ctx, u, domain.FeatureDailyStory, 1); !errors.Is(err, domain.ErrFeatureDisabled) {
		t.Errorf("Consume on a disabled feature: %v", err)
	}
	if err := s.Require(ctx, u, domain.FeatureWordSearch); err != nil {
		t.Errorf("other features stay on: %v", err)
	}

	if err := s.Set(ctx, u, domain.FeaturePhotoImport, true, ip(7)); err != nil {
		t.Fatal(err)
	}
	st, err := s.State(ctx, u, domain.FeaturePhotoImport)
	if err != nil || *st.DailyLimit != 7 || *st.LimitOverride != 7 || *st.DefaultLimit != defaultPhotoLimit {
		t.Errorf("limit override: %+v %v", st, err)
	}
	// limit nil again → back to the default
	_ = s.Set(ctx, u, domain.FeaturePhotoImport, true, nil)
	if st, _ := s.State(ctx, u, domain.FeaturePhotoImport); *st.DailyLimit != defaultPhotoLimit || st.LimitOverride != nil {
		t.Errorf("default restored: %+v", st)
	}
	// a limit on a feature that has none by default
	_ = s.Set(ctx, u, domain.FeatureWordSearch, true, ip(2))
	_, _ = s.Consume(ctx, u, domain.FeatureWordSearch, 2)
	if _, err := s.Consume(ctx, u, domain.FeatureWordSearch, 1); !errors.Is(err, domain.ErrDailyLimit) {
		t.Errorf("admin limit on word_search: %v", err)
	}
}

func TestFeatures_ConsumeUpToLimit(t *testing.T) {
	ctx, u := context.Background(), uuid.New()
	s := NewFeatureService(newMemFeatureRepo())
	for want := defaultPhotoLimit - 1; want >= 0; want-- {
		rem, err := s.Consume(ctx, u, domain.FeaturePhotoImport, 1)
		if err != nil || rem == nil || *rem != want {
			t.Fatalf("remaining %v (%v), want %d", rem, err, want)
		}
	}
	_, err := s.Consume(ctx, u, domain.FeaturePhotoImport, 1)
	if !errors.Is(err, domain.ErrDailyLimit) {
		t.Fatalf("over the limit: %v", err)
	}
	if n, ok := domain.DailyLimitOf(err); !ok || n != defaultPhotoLimit {
		t.Errorf("limit carried: %d %v", n, ok)
	}
	// n larger than what is left: nothing is charged
	_ = s.Refund(ctx, u, domain.FeaturePhotoImport, 2) // 2 left
	if _, err := s.Consume(ctx, u, domain.FeaturePhotoImport, 3); !errors.Is(err, domain.ErrDailyLimit) {
		t.Errorf("3 of 2 left: %v", err)
	}
	if st, _ := s.State(ctx, u, domain.FeaturePhotoImport); st.UsedToday != defaultPhotoLimit-2 {
		t.Errorf("used %d, want %d", st.UsedToday, defaultPhotoLimit-2)
	}
	// unlimited feature: no usage recorded
	if rem, err := s.Consume(ctx, u, domain.FeatureWordSearch, 1); rem != nil || err != nil {
		t.Errorf("unlimited: %v %v", rem, err)
	}
	if _, err := s.Consume(ctx, u, domain.FeatureWordSearch, 0); !errors.Is(err, domain.ErrValidation) {
		t.Errorf("n=0: %v", err)
	}
}

func TestFeatures_UsageResetsOnNextTashkentDay(t *testing.T) {
	ctx, u := context.Background(), uuid.New()
	now := time.Date(2026, 10, 29, 18, 0, 0, 0, time.UTC) // 23:00 in Tashkent
	s := NewFeatureService(newMemFeatureRepo(), WithFeatureClock(func() time.Time { return now }))
	for range defaultPhotoLimit {
		if _, err := s.Consume(ctx, u, domain.FeaturePhotoImport, 1); err != nil {
			t.Fatal(err)
		}
	}
	now = now.Add(59 * time.Minute) // 23:59 Tashkent, same day
	if _, err := s.Consume(ctx, u, domain.FeaturePhotoImport, 1); !errors.Is(err, domain.ErrDailyLimit) {
		t.Fatalf("same Tashkent day: %v", err)
	}
	now = now.Add(2 * time.Minute) // 19:01 UTC = 00:01 Tashkent next day (still the same UTC day)
	rem, err := s.Consume(ctx, u, domain.FeaturePhotoImport, 1)
	if err != nil || *rem != defaultPhotoLimit-1 {
		t.Fatalf("next Tashkent day: %v %v", rem, err)
	}
}

func TestFeatures_Refund(t *testing.T) {
	ctx, u := context.Background(), uuid.New()
	s := NewFeatureService(newMemFeatureRepo())
	_, _ = s.Consume(ctx, u, domain.FeaturePhotoImport, 3)
	_ = s.Refund(ctx, u, domain.FeaturePhotoImport, 1)
	if st, _ := s.State(ctx, u, domain.FeaturePhotoImport); st.UsedToday != 2 || *st.Remaining != defaultPhotoLimit-2 {
		t.Errorf("after refund: %+v", st)
	}
	_ = s.Refund(ctx, u, domain.FeaturePhotoImport, 10) // never below 0
	if st, _ := s.State(ctx, u, domain.FeaturePhotoImport); st.UsedToday != 0 || *st.Remaining != defaultPhotoLimit {
		t.Errorf("refund floor: %+v", st)
	}
}

func TestFeatures_SetValidation(t *testing.T) {
	ctx, u := context.Background(), uuid.New()
	s := NewFeatureService(newMemFeatureRepo())
	if err := s.Set(ctx, u, "nope", true, nil); !errors.Is(err, domain.ErrValidation) {
		t.Errorf("unknown feature: %v", err)
	}
	if err := s.Set(ctx, u, domain.FeaturePhotoImport, true, ip(-1)); !errors.Is(err, domain.ErrValidation) {
		t.Errorf("negative limit: %v", err)
	}
	if err := s.Set(ctx, u, domain.FeaturePhotoImport, true, ip(0)); err != nil {
		t.Errorf("limit 0 is allowed: %v", err)
	}
	if _, err := s.Consume(ctx, u, domain.FeaturePhotoImport, 1); !errors.Is(err, domain.ErrDailyLimit) {
		t.Errorf("limit 0 blocks: %v", err)
	}
}
