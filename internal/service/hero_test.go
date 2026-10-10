package service

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"

	"learnwords/internal/domain"
)

// --- fakes -------------------------------------------------------------

type fakeUserRepoForHero struct {
	user domain.User
}

func (f *fakeUserRepoForHero) Create(context.Context, *domain.User) error { return nil }
func (f *fakeUserRepoForHero) GetByEmail(context.Context, string) (*domain.User, error) {
	return &f.user, nil
}
func (f *fakeUserRepoForHero) GetByID(context.Context, uuid.UUID) (*domain.User, error) {
	u := f.user
	return &u, nil
}

type fakeHeroRepo struct {
	learnedCount int
	learnedWords []string
	stage        int
	hasStage     bool
}

func (f *fakeHeroRepo) CountLearned(context.Context, uuid.UUID, int) (int, error) {
	return f.learnedCount, nil
}
func (f *fakeHeroRepo) LearnedWords(context.Context, uuid.UUID, int) ([]string, error) {
	return f.learnedWords, nil
}
func (f *fakeHeroRepo) HeroStage(context.Context, uuid.UUID) (int, bool, error) {
	return f.stage, f.hasStage, nil
}
func (f *fakeHeroRepo) SetHeroStage(_ context.Context, _ uuid.UUID, stage int) error {
	f.stage, f.hasStage = stage, true
	return nil
}

func newHeroService(email, learningLang string, createdAt time.Time, allowed []string, repo *fakeHeroRepo) *HeroService {
	users := &fakeUserRepoForHero{user: domain.User{
		ID: uuid.New(), Email: email, LearningLanguage: learningLang, CreatedAt: createdAt,
	}}
	s := NewHeroService(users, repo, allowed)
	s.now = func() time.Time { return time.Date(2026, 6, 15, 12, 0, 0, 0, time.UTC) }
	s.pick = func(int) int { return 0 } // deterministic: always the first candidate
	return s
}

// --- 1. allowlist / learning-language gating ---------------------------

func TestHeroGet_NotAllowlisted_404(t *testing.T) {
	s := newHeroService("someone-else@example.com", "de", time.Now(), []string{"allowed@example.com"}, &fakeHeroRepo{})
	_, err := s.Get(context.Background(), uuid.New(), "ru")
	if err != domain.ErrNotFound {
		t.Fatalf("got %v, want domain.ErrNotFound", err)
	}
}

func TestHeroGet_AllowlistCaseInsensitive(t *testing.T) {
	s := newHeroService("Allowed@Example.com", "de", time.Now(), []string{"allowed@example.com"}, &fakeHeroRepo{})
	if _, err := s.Get(context.Background(), uuid.New(), "ru"); err != nil {
		t.Fatalf("expected access, got %v", err)
	}
}

func TestHeroGet_NotGerman_404(t *testing.T) {
	s := newHeroService("allowed@example.com", "en", time.Now(), []string{"allowed@example.com"}, &fakeHeroRepo{})
	_, err := s.Get(context.Background(), uuid.New(), "ru")
	if err != domain.ErrNotFound {
		t.Fatalf("got %v, want domain.ErrNotFound (hero is German-only)", err)
	}
}

// --- 2. stage boundaries -------------------------------------------------

func TestHeroStageFor_Boundaries(t *testing.T) {
	cases := []struct {
		count, want int
	}{
		{0, 1}, {49, 1}, {50, 2}, {199, 2}, {200, 3}, {499, 3},
		{500, 4}, {1299, 4}, {1300, 5}, {2399, 5}, {2400, 6}, {100000, 6},
	}
	for _, c := range cases {
		if got := heroStageFor(c.count); got != c.want {
			t.Errorf("heroStageFor(%d) = %d, want %d", c.count, got, c.want)
		}
	}
}

// --- 3. stage never decreases -------------------------------------------

func TestHeroGet_StageNeverDecreases(t *testing.T) {
	allowed := []string{"allowed@example.com"}
	repo := &fakeHeroRepo{learnedCount: 500, stage: 4, hasStage: true} // previously reached stage 4
	s := newHeroService("allowed@example.com", "de", time.Now(), allowed, repo)

	// Words regressed: now only 10 learned (would be stage 1 on its own).
	repo.learnedCount = 10
	hero, err := s.Get(context.Background(), uuid.New(), "ru")
	if err != nil {
		t.Fatal(err)
	}
	if hero.Stage != 4 {
		t.Errorf("stage = %d, want 4 (must not drop below the previously reached stage)", hero.Stage)
	}
	if hero.LearnedCount != 10 {
		t.Errorf("learned_count = %d, want the true current count (10)", hero.LearnedCount)
	}
	if hero.StageChanged {
		t.Error("stage_changed must be false — the effective stage did not grow")
	}
}

// --- stage_changed fires exactly once ------------------------------------

func TestHeroGet_StageChanged_FiresOnce(t *testing.T) {
	allowed := []string{"allowed@example.com"}
	repo := &fakeHeroRepo{learnedCount: 60} // stage 2, never computed before
	s := newHeroService("allowed@example.com", "de", time.Now(), allowed, repo)

	first, err := s.Get(context.Background(), uuid.New(), "ru")
	if err != nil {
		t.Fatal(err)
	}
	if first.StageChanged {
		t.Error("first-ever call must not report stage_changed (nothing to compare against)")
	}
	if first.Stage != 2 {
		t.Fatalf("stage = %d, want 2", first.Stage)
	}

	// Learn more words, crossing into stage 3.
	repo.learnedCount = 250
	second, err := s.Get(context.Background(), uuid.New(), "ru")
	if err != nil {
		t.Fatal(err)
	}
	if !second.StageChanged || second.Stage != 3 {
		t.Fatalf("second call: stage=%d stage_changed=%v, want stage=3 stage_changed=true", second.Stage, second.StageChanged)
	}

	// Same count again: must not re-report the change.
	third, err := s.Get(context.Background(), uuid.New(), "ru")
	if err != nil {
		t.Fatal(err)
	}
	if third.StageChanged {
		t.Error("stage_changed must not fire again once already recorded")
	}
}

// --- 4. birthday (Asia/Tashkent) ----------------------------------------

func TestIsHeroBirthday(t *testing.T) {
	loc, _ := time.LoadLocation("Asia/Tashkent")
	born := time.Date(2024, 6, 15, 10, 0, 0, 0, loc)

	if ok, _ := isHeroBirthday(born, born); ok {
		t.Error("registration day itself is not a birthday (0 years)")
	}
	oneYearLater := time.Date(2025, 6, 15, 9, 0, 0, 0, loc)
	if ok, years := isHeroBirthday(born, oneYearLater); !ok || years != 1 {
		t.Errorf("isHeroBirthday = %v/%d, want true/1", ok, years)
	}
	twoYearsLater := time.Date(2026, 6, 15, 23, 59, 0, 0, loc)
	if ok, years := isHeroBirthday(born, twoYearsLater); !ok || years != 2 {
		t.Errorf("isHeroBirthday = %v/%d, want true/2", ok, years)
	}
	notBirthday := time.Date(2025, 6, 16, 0, 1, 0, 0, loc)
	if ok, _ := isHeroBirthday(born, notBirthday); ok {
		t.Error("the day after must not count")
	}
	// A time that's past midnight in UTC but still the birthday in Asia/Tashkent (UTC+5).
	bornUTCEdge := time.Date(2024, 6, 15, 1, 0, 0, 0, time.UTC)        // 06:00 in Tashkent
	almostMidnightUTC := time.Date(2025, 6, 14, 20, 0, 0, 0, time.UTC) // 01:00 next day in Tashkent
	if ok, _ := isHeroBirthday(bornUTCEdge, almostMidnightUTC); !ok {
		t.Error("must compare dates in Asia/Tashkent, not server-local/UTC")
	}
}

// --- 5. phrase: gender, plural exclusion, fallback -----------------------

func TestHeroPhrase_AllThreeGenders(t *testing.T) {
	pick0 := func(int) int { return 0 }
	cases := []struct {
		stage int
		word  string
		want  string
	}{
		{1, "der Hund", "Hund!"},
		{1, "die Katze", "Katze!"},
		{1, "das Kind", "Kind!"},
		{2, "der Hund", "Ich will den Hund."},
		{2, "die Katze", "Ich will die Katze."},
		{2, "das Kind", "Ich will das Kind."},
		{3, "der Hund", "Ich habe einen Hund."},
		{3, "die Katze", "Ich habe eine Katze."},
		{3, "das Kind", "Ich habe ein Kind."},
		{4, "der Hund", "Heute sehe ich den Hund."},
		{5, "die Katze", "Ich möchte eine Katze kaufen."},
	}
	for _, c := range cases {
		if got := heroPhrase(c.stage, []string{c.word}, pick0); got != c.want {
			t.Errorf("heroPhrase(%d, %q) = %q, want %q", c.stage, c.word, got, c.want)
		}
	}
	if got := heroPhrase(6, nil, pick0); got != "Ich möchte in Deutschland arbeiten und leben." {
		t.Errorf("stage 6 phrase = %q", got)
	}
}

func TestHeroPhrase_SkipsWordsWithoutKnownGender(t *testing.T) {
	pick0 := func(int) int { return 0 }
	// "laufen" (no article) must be skipped; only "der Hund" is a valid candidate.
	got := heroPhrase(1, []string{"laufen", "der Hund"}, pick0)
	if got != "Hund!" {
		t.Errorf("got %q, want %q (the genderless word must be skipped)", got, "Hund!")
	}
}

func TestHeroPhrase_SkipsPluralOnlyNouns(t *testing.T) {
	pick0 := func(int) int { return 0 }
	got := heroPhrase(1, []string{"die Leute"}, pick0)
	if got != heroFallbackPhrases[0] {
		t.Errorf("got %q, want the fallback %q (plural-only noun must be skipped)", got, heroFallbackPhrases[0])
	}
}

func TestHeroPhrase_FallbackWhenNoCandidates(t *testing.T) {
	pick0 := func(int) int { return 0 }
	for stage := 1; stage <= 5; stage++ {
		if got := heroPhrase(stage, nil, pick0); got != heroFallbackPhrases[stage-1] {
			t.Errorf("stage %d: got %q, want fallback %q", stage, got, heroFallbackPhrases[stage-1])
		}
	}
}
