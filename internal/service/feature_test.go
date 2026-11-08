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
	mu      sync.Mutex
	ov      map[string]domain.FeatureOverride
	usage   map[string]int // feature|day
	credits map[string]int // feature → purchased balance
}

func newMemFeatureRepo() *memFeatureRepo {
	return &memFeatureRepo{ov: map[string]domain.FeatureOverride{}, usage: map[string]int{}, credits: map[string]int{}}
}

func (r *memFeatureRepo) Credits(context.Context, uuid.UUID) (map[string]int, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := map[string]int{}
	for k, v := range r.credits {
		out[k] = v
	}
	return out, nil
}

func (r *memFeatureRepo) setCredits(feature string, n int) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.credits[feature] = n
}

func (r *memFeatureRepo) used(feature, day string) int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.usage[feature+"|"+day]
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

func (r *memFeatureRepo) Consume(_ context.Context, _ uuid.UUID, feature, day string, n, limit int) (domain.ConsumeResult, bool, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	k := feature + "|" + day
	left := max(limit-r.usage[k], 0)
	res := domain.ConsumeResult{FromDaily: min(n, left), Day: day}
	res.FromCredits = n - res.FromDaily
	if res.FromCredits > r.credits[feature] {
		return domain.ConsumeResult{DailyRemaining: &left, Credits: r.credits[feature], Day: day}, false, nil
	}
	r.usage[k] += res.FromDaily
	r.credits[feature] -= res.FromCredits
	rem := left - res.FromDaily
	res.DailyRemaining, res.Credits = &rem, r.credits[feature]
	return res, true, nil
}

func (r *memFeatureRepo) Refund(_ context.Context, _ uuid.UUID, feature, day string, res domain.ConsumeResult) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	k := feature + "|" + day
	r.usage[k] = max(r.usage[k]-res.FromDaily, 0)
	r.credits[feature] += res.FromCredits
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
const defaultPhotoLimit = 5

func TestFeatures_DefaultsWithoutOverrides(t *testing.T) {
	s := NewFeatureService(newMemFeatureRepo())
	states, err := s.States(context.Background(), uuid.New())
	if err != nil {
		t.Fatal(err)
	}
	if len(states) != 5 || states[0].Feature != domain.FeaturePhotoImport || states[3].Feature != domain.FeatureStoryAutotranslate ||
		states[4].Feature != domain.FeatureThemePicker {
		t.Fatalf("catalog order: %+v", states)
	}
	p := states[0]
	if !p.Enabled || p.DailyLimit == nil || *p.DailyLimit != defaultPhotoLimit || *p.DefaultLimit != defaultPhotoLimit || p.LimitOverride != nil ||
		*p.Remaining != defaultPhotoLimit || p.Credits != 0 {
		t.Errorf("photo_import: %+v", p)
	}
	for _, st := range states[1:] {
		// daily_story is unfinished: off until the admin turns it on (DisabledByDefault)
		wantOn := st.Feature != domain.FeatureDailyStory
		if st.Enabled != wantOn || st.DailyLimit != nil || st.Remaining != nil {
			t.Errorf("%s must be unlimited and enabled=%v: %+v", st.Feature, wantOn, st)
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
		res, err := s.Consume(ctx, u, domain.FeaturePhotoImport, 1)
		if err != nil || res.DailyRemaining == nil || *res.DailyRemaining != want || res.FromDaily != 1 || res.FromCredits != 0 {
			t.Fatalf("result %+v (%v), want %d remaining", res, err, want)
		}
	}
	_, err := s.Consume(ctx, u, domain.FeaturePhotoImport, 1)
	if !errors.Is(err, domain.ErrDailyLimit) {
		t.Fatalf("over the limit: %v", err)
	}
	if n, ok := domain.DailyLimitOf(err); !ok || n != defaultPhotoLimit {
		t.Errorf("limit carried: %d %v", n, ok)
	}
	if n, ok := domain.CreditsOf(err); !ok || n != 0 {
		t.Errorf("credits carried: %d %v", n, ok)
	}
	// n larger than what is left: nothing is charged
	_ = s.Refund(ctx, u, domain.FeaturePhotoImport, domain.ConsumeResult{FromDaily: 2}) // 2 left
	if _, err := s.Consume(ctx, u, domain.FeaturePhotoImport, 3); !errors.Is(err, domain.ErrDailyLimit) {
		t.Errorf("3 of 2 left: %v", err)
	}
	if st, _ := s.State(ctx, u, domain.FeaturePhotoImport); st.UsedToday != defaultPhotoLimit-2 {
		t.Errorf("used %d, want %d", st.UsedToday, defaultPhotoLimit-2)
	}
	// unlimited feature: no usage recorded
	if res, err := s.Consume(ctx, u, domain.FeatureWordSearch, 1); res.DailyRemaining != nil || res.FromDaily != 0 || err != nil {
		t.Errorf("unlimited: %+v %v", res, err)
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
	res, err := s.Consume(ctx, u, domain.FeaturePhotoImport, 1)
	if err != nil || *res.DailyRemaining != defaultPhotoLimit-1 {
		t.Fatalf("next Tashkent day: %+v %v", res, err)
	}
}

func TestFeatures_Refund(t *testing.T) {
	ctx, u := context.Background(), uuid.New()
	s := NewFeatureService(newMemFeatureRepo())
	_, _ = s.Consume(ctx, u, domain.FeaturePhotoImport, 3)
	_ = s.Refund(ctx, u, domain.FeaturePhotoImport, domain.ConsumeResult{FromDaily: 1})
	if st, _ := s.State(ctx, u, domain.FeaturePhotoImport); st.UsedToday != 2 || *st.Remaining != defaultPhotoLimit-2 {
		t.Errorf("after refund: %+v", st)
	}
	_ = s.Refund(ctx, u, domain.FeaturePhotoImport, domain.ConsumeResult{FromDaily: 10}) // never below 0
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

// theme_picker is on for everybody; the admin can switch it off for a user (and on again).
func TestFeatures_ThemePickerIsOnByDefault_AdminCanTurnItOff(t *testing.T) {
	ctx, u := context.Background(), uuid.New()
	s := NewFeatureService(newMemFeatureRepo())

	st, err := s.State(ctx, u, domain.FeatureThemePicker)
	if err != nil || !st.Enabled || st.DailyLimit != nil || st.LimitOverride != nil {
		t.Fatalf("default: %+v %v", st, err)
	}
	if err := s.Require(ctx, u, domain.FeatureThemePicker); err != nil {
		t.Errorf("Require without an override: %v", err)
	}

	// an admin override "off" turns it off for that user only
	if err := s.Set(ctx, u, domain.FeatureThemePicker, false, nil); err != nil {
		t.Fatal(err)
	}
	if st, _ = s.State(ctx, u, domain.FeatureThemePicker); st.Enabled {
		t.Errorf("after the admin disabled it: %+v", st)
	}
	if err := s.Require(ctx, u, domain.FeatureThemePicker); !errors.Is(err, domain.ErrFeatureDisabled) {
		t.Errorf("Require after disabling: %v", err)
	}
	// and on again
	_ = s.Set(ctx, u, domain.FeatureThemePicker, true, nil)
	if err := s.Require(ctx, u, domain.FeatureThemePicker); err != nil {
		t.Errorf("after enabling again: %v", err)
	}
}

// Purchased credits are spent only after the free units of the day, one source after the other,
// and a request that fits into neither alone nor both together changes nothing.
func TestFeatures_CreditsAfterTheFreeUnits(t *testing.T) {
	ctx, u := context.Background(), uuid.New()
	repo := newMemFeatureRepo()
	repo.setCredits(domain.FeaturePhotoImport, 3)
	s := NewFeatureService(repo)

	for i := range defaultPhotoLimit {
		res, err := s.Consume(ctx, u, domain.FeaturePhotoImport, 1)
		if err != nil || res.FromDaily != 1 || res.FromCredits != 0 || res.Credits != 3 {
			t.Fatalf("free photo %d: %+v %v", i+1, res, err)
		}
	}
	for want := 2; want >= 0; want-- {
		res, err := s.Consume(ctx, u, domain.FeaturePhotoImport, 1)
		if err != nil || res.FromDaily != 0 || res.FromCredits != 1 || res.Credits != want || *res.DailyRemaining != 0 {
			t.Fatalf("credit, %d left: %+v %v", want, res, err)
		}
	}
	_, err := s.Consume(ctx, u, domain.FeaturePhotoImport, 1)
	if !errors.Is(err, domain.ErrDailyLimit) {
		t.Fatalf("both used up: %v", err)
	}
	if n, _ := domain.DailyLimitOf(err); n != defaultPhotoLimit {
		t.Errorf("limit %d", n)
	}
	if n, ok := domain.CreditsOf(err); !ok || n != 0 {
		t.Errorf("credits %d %v", n, ok)
	}

	// one request split over both sources, and the refund gives each its own part back
	u2 := uuid.New()
	repo2 := newMemFeatureRepo()
	repo2.setCredits(domain.FeaturePhotoImport, 2)
	s2 := NewFeatureService(repo2)
	_, _ = s2.Consume(ctx, u2, domain.FeaturePhotoImport, defaultPhotoLimit-1) // 1 free left
	if _, err := s2.Consume(ctx, u2, domain.FeaturePhotoImport, 4); !errors.Is(err, domain.ErrDailyLimit) {
		t.Fatalf("1 free + 2 credits < 4: %v", err)
	}
	if st, _ := s2.State(ctx, u2, domain.FeaturePhotoImport); st.UsedToday != defaultPhotoLimit-1 || st.Credits != 2 {
		t.Fatalf("a refused request changes nothing: %+v", st)
	}
	res, err := s2.Consume(ctx, u2, domain.FeaturePhotoImport, 3)
	if err != nil || res.FromDaily != 1 || res.FromCredits != 2 || res.Credits != 0 || *res.DailyRemaining != 0 {
		t.Fatalf("split: %+v %v", res, err)
	}
	if err := s2.Refund(ctx, u2, domain.FeaturePhotoImport, res); err != nil {
		t.Fatal(err)
	}
	if st, _ := s2.State(ctx, u2, domain.FeaturePhotoImport); st.UsedToday != defaultPhotoLimit-1 || st.Credits != 2 || *st.Remaining != 1 {
		t.Errorf("refund to both sources: %+v", st)
	}
}

// An unlimited feature records nothing and never spends credits.
func TestFeatures_UnlimitedNeverTouchesCredits(t *testing.T) {
	ctx, u := context.Background(), uuid.New()
	repo := newMemFeatureRepo()
	repo.setCredits(domain.FeatureWordSearch, 2)
	s := NewFeatureService(repo)
	res, err := s.Consume(ctx, u, domain.FeatureWordSearch, 5)
	if err != nil || res.FromDaily != 0 || res.FromCredits != 0 || res.DailyRemaining != nil || res.Credits != 2 {
		t.Fatalf("%+v %v", res, err)
	}
	if st, _ := s.State(ctx, u, domain.FeatureWordSearch); st.Credits != 2 || st.UsedToday != 0 {
		t.Errorf("%+v", st)
	}
}

// A refund after midnight goes back to the day the unit was taken from, not to the new day.
func TestFeatures_RefundGoesBackToItsDay(t *testing.T) {
	ctx, u := context.Background(), uuid.New()
	now := time.Date(2026, 10, 29, 18, 59, 0, 0, time.UTC) // 23:59 in Tashkent
	repo := newMemFeatureRepo()
	s := NewFeatureService(repo, WithFeatureClock(func() time.Time { return now }))
	_, _ = s.Consume(ctx, u, domain.FeaturePhotoImport, 1)
	res, err := s.Consume(ctx, u, domain.FeaturePhotoImport, 1)
	if err != nil {
		t.Fatal(err)
	}
	now = now.Add(2 * time.Minute) // 00:01 the next day
	_, _ = s.Consume(ctx, u, domain.FeaturePhotoImport, 1)
	if err := s.Refund(ctx, u, domain.FeaturePhotoImport, res); err != nil {
		t.Fatal(err)
	}
	if a, b := repo.used(domain.FeaturePhotoImport, "2026-10-29"), repo.used(domain.FeaturePhotoImport, "2026-10-30"); a != 1 || b != 1 {
		t.Errorf("used %d on the first day, %d on the next; want 1 and 1", a, b)
	}
}
