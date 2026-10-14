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
	almostCount  int
	learnedWords []domain.HeroWord
	stage        int
	hasStage     bool
	seen         int
	hasSeen      bool
	due          int
	activeDays   []time.Time
}

func (f *fakeHeroRepo) CountLearned(context.Context, uuid.UUID) (int, error) {
	return f.learnedCount, nil
}
func (f *fakeHeroRepo) CountAlmostLearned(context.Context, uuid.UUID, int) (int, error) {
	return f.almostCount, nil
}
func (f *fakeHeroRepo) LearnedWords(context.Context, uuid.UUID, string) ([]domain.HeroWord, error) {
	return f.learnedWords, nil
}
func (f *fakeHeroRepo) HeroStage(context.Context, uuid.UUID) (int, bool, error) {
	return f.stage, f.hasStage, nil
}
func (f *fakeHeroRepo) SetHeroStage(_ context.Context, _ uuid.UUID, stage int) error {
	f.stage, f.hasStage = stage, true
	return nil
}
func (f *fakeHeroRepo) StageSeen(context.Context, uuid.UUID) (int, bool, error) {
	return f.seen, f.hasSeen, nil
}
func (f *fakeHeroRepo) SetStageSeen(_ context.Context, _ uuid.UUID, stage int) error {
	f.seen, f.hasSeen = stage, true
	return nil
}
func (f *fakeHeroRepo) CountDueToday(context.Context, uuid.UUID, time.Time) (int, error) {
	return f.due, nil
}
func (f *fakeHeroRepo) ActiveDaysSince(context.Context, uuid.UUID, time.Time) ([]time.Time, error) {
	return f.activeDays, nil
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
	if hero.StageUp {
		t.Error("stage_up must be false — the effective stage did not grow")
	}
}

// --- stage_up: set once on growth, cleared by stage-seen ----------------

func TestHeroGet_StageUp_UntilSeen(t *testing.T) {
	allowed := []string{"allowed@example.com"}
	repo := &fakeHeroRepo{learnedCount: 60} // stage 2, never computed before
	s := newHeroService("allowed@example.com", "de", time.Now(), allowed, repo)
	uid := uuid.New()
	get := func() *domain.Hero {
		t.Helper()
		h, err := s.Get(context.Background(), uid, "ru")
		if err != nil {
			t.Fatal(err)
		}
		return h
	}

	if h := get(); h.StageUp || h.Stage != 2 {
		t.Fatalf("first-ever call: stage=%d stage_up=%v, want 2/false (nothing grew yet)", h.Stage, h.StageUp)
	}

	repo.learnedCount = 250 // crosses into stage 3
	h := get()
	if !h.StageUp || h.Stage != 3 {
		t.Fatalf("after growth: stage=%d stage_up=%v, want 3/true", h.Stage, h.StageUp)
	}
	if h.Phrase.De != heroGrowthLine.de {
		t.Errorf("phrase while stage_up = %q, want the growth line", h.Phrase.De)
	}
	if !get().StageUp {
		t.Fatal("stage_up must stay true until the congratulation is marked as seen")
	}

	if err := s.MarkStageSeen(context.Background(), uid); err != nil {
		t.Fatal(err)
	}
	if get().StageUp {
		t.Fatal("stage_up must be false after stage-seen")
	}

	repo.learnedCount = 600 // stage 4: a new congratulation
	if !get().StageUp {
		t.Fatal("stage_up must turn true again on the next growth")
	}
}

func TestHeroMarkStageSeen_NotAllowlisted_404(t *testing.T) {
	s := newHeroService("x@example.com", "de", time.Now(), []string{"allowed@example.com"}, &fakeHeroRepo{})
	if err := s.MarkStageSeen(context.Background(), uuid.New()); err != domain.ErrNotFound {
		t.Fatalf("got %v, want ErrNotFound", err)
	}
}

// --- mood ------------------------------------------------------------------

func TestHeroMood(t *testing.T) {
	today := time.Date(2026, 6, 15, 0, 0, 0, 0, time.UTC)
	day := func(offset int) time.Time { return today.AddDate(0, 0, offset) }
	cases := []struct {
		name   string
		due    int
		active []time.Time
		want   string
	}{
		{"sleepy: words due, no training today", 7, []time.Time{day(-1)}, domain.HeroSleepy},
		{"happy: trained today, nothing due", 0, []time.Time{day(0), day(-1)}, domain.HeroHappy},
		{"sad: streak broke yesterday", 3, []time.Time{day(-2)}, domain.HeroSad},
		{"idle: trained today but words still due", 4, []time.Time{day(0)}, domain.HeroIdle},
		{"idle: nothing due, no training today", 0, []time.Time{day(-1)}, domain.HeroIdle},
		{"sad only on the first day after the break", 3, []time.Time{day(-3)}, domain.HeroSleepy},
		{"training today beats sad", 0, []time.Time{day(0), day(-2)}, domain.HeroHappy},
	}
	for _, c := range cases {
		if got := heroMood(c.due, c.active, today); got != c.want {
			t.Errorf("%s: got %s, want %s", c.name, got, c.want)
		}
	}
}

func TestHeroGet_ReturnsMood(t *testing.T) {
	now := time.Date(2026, 6, 15, 12, 0, 0, 0, time.UTC)
	repo := &fakeHeroRepo{due: 5}
	s := newHeroService("allowed@example.com", "de", now.AddDate(0, -1, 0), []string{"allowed@example.com"}, repo)
	h, err := s.Get(context.Background(), uuid.New(), "ru")
	if err != nil || h.Mood != domain.HeroSleepy {
		t.Fatalf("mood = %q (%v), want sleepy", h.Mood, err)
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

// --- 5. phrase: gender, case, translation, only learned words ---------------

func noun(word, tr string) domain.HeroWord { return domain.HeroWord{Word: word, Translation: tr} }

func TestHeroPhrase_ArticlesAndCases(t *testing.T) {
	pick0 := func(int) int { return 0 }
	cases := []struct {
		stage  int
		word   domain.HeroWord
		lang   string
		wantDe string
		wantTr string
	}{
		{1, noun("der Hund", "собака"), "ru", "Der Hund!", "Собака!"},
		{2, noun("die Katze", "кошка"), "ru", "Wo ist die Katze?", "Где кошка?"},
		{3, noun("der Hund", "собака"), "ru", "Ich habe einen Hund.", "У меня есть собака."},
		{3, noun("die Katze", "cat"), "en", "Ich habe eine Katze.", "I have a cat."},
		{3, noun("das Ei", "egg"), "en", "Ich habe ein Ei.", "I have an egg."},
		{4, noun("das Kind", "bola"), "uz", "Mir gefällt das Kind sehr.", "Bola menga juda yoqadi."},
		{5, noun("der Weg", "дорога"), "ru", "Kannst du mir bitte den Weg zeigen?", "Покажешь мне, где дорога?"},
		{6, noun("das Buch", "the book"), "en", "Ohne das Buch kann ich nicht leben.", "I can't live without the book."},
		// grammar from the word check wins over the saved text ("Sfit" accepted as der Stift)
		{3, domain.HeroWord{Word: "Stift", Lemma: "Stift", Article: "der", PartOfSpeech: "noun", Translation: "ручка, карандаш"}, "ru",
			"Ich habe einen Stift.", "У меня есть ручка."},
	}
	for _, c := range cases {
		got := heroPhrase(c.stage, []domain.HeroWord{c.word}, c.lang, pick0)
		if got.De != c.wantDe || got.Translation != c.wantTr {
			t.Errorf("stage %d %q: got %+v, want %q / %q", c.stage, c.word.Word, got, c.wantDe, c.wantTr)
		}
	}
}

// The phrase never contains a word the user hasn't learned: the only open slot is filled from
// the learned list, and without a suitable learned noun the stage's own ready phrase is used.
func TestHeroPhrase_OnlyLearnedWords(t *testing.T) {
	learned := []domain.HeroWord{
		noun("der Hund", "собака"),
		noun("die Katze", "кошка"),
		noun("laufen", "бегать"),  // not a noun → skipped
		noun("die Leute", "люди"), // plural-only → skipped
		noun("das Haus", ""),      // no translation in this language → skipped
		{Word: "schnell", PartOfSpeech: "adjective", Translation: "быстрый"}, // not a noun
	}
	usable := map[string]bool{"Hund": true, "Katze": true}
	for stage := 1; stage <= 6; stage++ {
		for i := 0; i < 2; i++ {
			got := heroPhrase(stage, learned, "ru", func(int) int { return i })
			ok := false
			for n := range usable {
				for _, a := range []string{"der", "die"} {
					if want := renderHeroTemplate(stage-1, heroNoun{article: a, noun: n, translation: map[string]string{"Hund": "собака", "Katze": "кошка"}[n]}, "ru"); got == want {
						ok = true
					}
				}
			}
			if !ok {
				t.Errorf("stage %d: phrase %q is not a template filled with a learned noun", stage, got.De)
			}
		}
	}

	none := []domain.HeroWord{noun("laufen", "бегать"), noun("das Haus", ""), noun("die Leute", "люди")}
	for stage := 1; stage <= 6; stage++ {
		got := heroPhrase(stage, none, "en", func(int) int { return 0 })
		if want := heroStageSay[stage-1][0].phrase("en"); got != want {
			t.Errorf("stage %d without usable nouns: got %+v, want the stage's ready phrase %+v", stage, got, want)
		}
	}
}

func TestHeroStageNames(t *testing.T) {
	if got := heroStageName(1, "ru"); got != "Маленький Моцарт" {
		t.Errorf("stage 1 ru = %q", got)
	}
	if got := heroStageName(6, "uz"); got != "Gyote" {
		t.Errorf("stage 6 uz = %q", got)
	}
	if got := heroStageName(2, "xx"); got != "Братья Гримм" {
		t.Errorf("fallback = %q", got)
	}
}
