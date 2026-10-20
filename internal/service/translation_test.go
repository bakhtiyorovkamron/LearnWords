package service

import (
	"context"
	"sync"
	"testing"

	"github.com/google/uuid"

	"learnwords/internal/domain"
)

type fakeCards struct {
	WordCardRepository
	card *domain.WordCard
}

func (f fakeCards) GetByID(context.Context, uuid.UUID, uuid.UUID) (*domain.WordCard, error) {
	c := *f.card
	return &c, nil
}

type memTrCache struct {
	mu   sync.Mutex
	rows map[string][2]string
	gets int
}

func (c *memTrCache) Get(_ context.Context, id uuid.UUID, lang string) (string, string, bool, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.gets++
	r, ok := c.rows[id.String()+lang]
	return r[0], r[1], ok, nil
}
func (c *memTrCache) Put(_ context.Context, id uuid.UUID, lang, tr, ex string) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.rows[id.String()+lang] = [2]string{tr, ex}
	return nil
}

type recAI struct {
	reqs []domain.TranslateRequest
	out  string
}

func (a *recAI) TranslateCard(_ context.Context, req domain.TranslateRequest) (string, string, error) {
	a.reqs = append(a.reqs, req)
	return a.out, "", nil
}

func strPtr(s string) *string { return &s }

func stillCard() *domain.WordCard {
	return &domain.WordCard{
		ID: uuid.New(), Word: "still", Language: "de",
		Translation: "тихий, спокойный", TranslationLanguage: strPtr("ru"),
		ExampleSentence: "Das Kind ist ___.", ExampleTranslation: "Ребёнок спокоен.",
	}
}

func TestTranslate_OwnLanguageComesFromTheCard_NoCacheNoAI(t *testing.T) {
	card := stillCard()
	// The cache holds the wrong AI answer from before the fix: the card must win.
	cache := &memTrCache{rows: map[string][2]string{card.ID.String() + "ru": {"ещё", "wrong"}}}
	ai := &recAI{out: "should not be used"}
	svc := NewTranslationService(fakeCards{card: card}, cache, ai)

	got, err := svc.Translate(context.Background(), uuid.New(), card.ID, "ru")
	if err != nil {
		t.Fatal(err)
	}
	if got.Translation != "тихий, спокойный" || got.ExampleTranslation != "Ребёнок спокоен." {
		t.Errorf("got %+v, want the card's own translation", got)
	}
	if len(ai.reqs) != 0 || cache.gets != 0 {
		t.Errorf("AI calls %d, cache reads %d — both must be 0", len(ai.reqs), cache.gets)
	}
}

func TestTranslate_OtherLanguage_AskedWithMeaningHintAndFullSentence_ThenCached(t *testing.T) {
	card := stillCard()
	cache := &memTrCache{rows: map[string][2]string{}}
	ai := &recAI{out: "tinch"}
	svc := NewTranslationService(fakeCards{card: card}, cache, ai)

	for i := 0; i < 2; i++ {
		got, err := svc.Translate(context.Background(), uuid.New(), card.ID, "uz")
		if err != nil || got.Translation != "tinch" {
			t.Fatalf("try %d: %+v %v", i, got, err)
		}
	}
	if len(ai.reqs) != 1 {
		t.Fatalf("AI called %d times, want 1 (second answer from the cache)", len(ai.reqs))
	}
	r := ai.reqs[0]
	if r.KnownMeaning != "тихий, спокойный" || r.KnownMeaningLang != "ru" {
		t.Errorf("hint: %q in %q", r.KnownMeaning, r.KnownMeaningLang)
	}
	if r.ExampleSentence != "Das Kind ist still." {
		t.Errorf("the example must be the FULL sentence, got %q", r.ExampleSentence)
	}
	if r.Word != "still" || r.LearningLang != "de" || r.NativeLang != "uz" {
		t.Errorf("request: %+v", r)
	}
}

func TestFillGap(t *testing.T) {
	lemma := "Hund"
	cases := []struct {
		name string
		card domain.WordCard
		want string
	}{
		{"lemma wins", domain.WordCard{Word: "Hunde", Lemma: &lemma, ExampleSentence: "Ich sehe zwei ___."}, "Ich sehe zwei Hund."},
		{"word without its article", domain.WordCard{Word: "der Hund", ExampleSentence: "Der ___ bellt."}, "Der Hund bellt."},
		{"first spelling variant", domain.WordCard{Word: "der Samstag / der Sonnabend", ExampleSentence: "Am ___ schlafe ich."}, "Am Samstag schlafe ich."},
		{"no gap: unchanged", domain.WordCard{Word: "still", ExampleSentence: "Es ist ruhig."}, "Es ist ruhig."},
		{"no example", domain.WordCard{Word: "still"}, ""},
		{"every gap", domain.WordCard{Word: "still", ExampleSentence: "___ ist ___."}, "still ist still."},
	}
	for _, c := range cases {
		if got := fillGap(&c.card); got != c.want {
			t.Errorf("%s: %q, want %q", c.name, got, c.want)
		}
	}
}

func TestTranslate_UnknownCardLanguage_StillSendsTheMeaning(t *testing.T) {
	card := stillCard()
	card.TranslationLanguage = nil // an old card that isn't Cyrillic
	cache := &memTrCache{rows: map[string][2]string{}}
	ai := &recAI{out: "quiet"}
	svc := NewTranslationService(fakeCards{card: card}, cache, ai)
	// No own-language shortcut without a known language: goes to the cache/AI as before.
	if _, err := svc.Translate(context.Background(), uuid.New(), card.ID, "ru"); err != nil {
		t.Fatal(err)
	}
	if len(ai.reqs) != 1 || ai.reqs[0].KnownMeaning == "" || ai.reqs[0].KnownMeaningLang != "" {
		t.Errorf("requests: %+v", ai.reqs)
	}
}
