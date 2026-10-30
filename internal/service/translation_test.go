package service

import (
	"context"
	"errors"
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
	ex   string // the example translation the AI answers with
	err  error
}

func (a *recAI) TranslateCard(_ context.Context, req domain.TranslateRequest) (string, string, error) {
	a.reqs = append(a.reqs, req)
	return a.out, a.ex, a.err
}

func strPtr(s string) *string { return &s }

func stillCard() *domain.WordCard {
	return &domain.WordCard{
		ID: uuid.New(), Word: "still", Language: "de",
		Translation: "тихий, спокойный", TranslationLanguage: strPtr("ru"),
		ExampleSentence: "Das Kind ist ___.", ExampleTranslation: "Ребёнок спокоен.", ExampleTranslationLanguage: strPtr("ru"),
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
	ai := &recAI{out: "tinch", ex: "Bola tinch."}
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

// --- the example may be in another language than the word ----------------------------------------

// fearCard: the word is Uzbek, the example translation was made before the prompt fix — Russian.
func fearCard() *domain.WordCard {
	return &domain.WordCard{
		ID: uuid.New(), Word: "die Angst", Language: "de",
		Translation: "qo‘rquv", TranslationLanguage: strPtr("uz"),
		ExampleSentence: "Ich habe ___.", ExampleTranslation: "Мне страшно.", ExampleTranslationLanguage: strPtr("ru"),
	}
}

func TestTranslate_UzWordWithRussianExample_KeepsTheWord_TranslatesTheExample_ThenCaches(t *testing.T) {
	card := fearCard()
	cache := &memTrCache{rows: map[string][2]string{}}
	ai := &recAI{out: "AI WORD", ex: "Men qo‘rqaman."}
	svc := NewTranslationService(fakeCards{card: card}, cache, ai)

	for i := 0; i < 2; i++ {
		got, err := svc.Translate(context.Background(), uuid.New(), card.ID, "uz")
		if err != nil {
			t.Fatal(err)
		}
		if got.Translation != "qo‘rquv" {
			t.Errorf("try %d: the card's own word must be kept, got %q", i, got.Translation)
		}
		if got.ExampleTranslation != "Men qo‘rqaman." || hasCyrillic(got.ExampleTranslation) {
			t.Errorf("try %d: example %q must come from the AI, not from the Russian text", i, got.ExampleTranslation)
		}
	}
	if len(ai.reqs) != 1 {
		t.Fatalf("AI called %d times, want 1 (the second answer is cached)", len(ai.reqs))
	}
	if r := ai.reqs[0]; r.KnownMeaning != "qo‘rquv" || r.KnownMeaningLang != "uz" || r.ExampleSentence != "Ich habe die Angst." && r.ExampleSentence != "Ich habe Angst." {
		t.Errorf("request: %+v", r)
	}
	if row := cache.rows[card.ID.String()+"uz"]; row != [2]string{"qo‘rquv", "Men qo‘rqaman."} {
		t.Errorf("cache row %v: own word + the new example", row)
	}
}

func TestTranslate_SameCardForRussian_UsesTheStoredRussianExample_NoAI(t *testing.T) {
	card := fearCard()
	// the word's Russian translation is known (cached); the example is already Russian on the card
	cache := &memTrCache{rows: map[string][2]string{card.ID.String() + "ru": {"страх", ""}}}
	ai := &recAI{out: "must not be asked"}
	svc := NewTranslationService(fakeCards{card: card}, cache, ai)

	got, err := svc.Translate(context.Background(), uuid.New(), card.ID, "ru")
	if err != nil || got.Translation != "страх" || got.ExampleTranslation != "Мне страшно." {
		t.Fatalf("%+v %v", got, err)
	}
	if len(ai.reqs) != 0 {
		t.Errorf("AI was called: %v", ai.reqs)
	}
}

func TestTranslate_BothInTheNativeLanguage_NoCacheNoAI(t *testing.T) {
	card := fearCard()
	card.ExampleTranslation, card.ExampleTranslationLanguage = "Menga qo‘rqinchli.", strPtr("uz")
	cache := &memTrCache{rows: map[string][2]string{}}
	ai := &recAI{out: "must not be asked"}
	got, err := NewTranslationService(fakeCards{card: card}, cache, ai).Translate(context.Background(), uuid.New(), card.ID, "uz")
	if err != nil || got != (CardTranslation{Translation: "qo‘rquv", ExampleTranslation: "Menga qo‘rqinchli."}) {
		t.Fatalf("%+v %v", got, err)
	}
	if len(ai.reqs) != 0 || cache.gets != 0 {
		t.Errorf("AI calls %d, cache reads %d — both must be 0", len(ai.reqs), cache.gets)
	}
}

func TestTranslate_CyrillicIsNeverAnUzOrEnExample_WhateverTheColumnSays(t *testing.T) {
	for _, native := range []string{"uz", "en"} {
		card := fearCard()
		card.Translation, card.TranslationLanguage = "fear", strPtr("en")
		if native == "uz" {
			card.Translation, card.TranslationLanguage = "qo‘rquv", strPtr("uz")
		}
		card.ExampleTranslationLanguage = strPtr(native) // the column LIES: it says native, the text is Russian
		cache := &memTrCache{rows: map[string][2]string{card.ID.String() + native: {card.Translation, "Мне страшно."}}}
		ai := &recAI{out: "x", ex: "Translated."}
		got, err := NewTranslationService(fakeCards{card: card}, cache, ai).Translate(context.Background(), uuid.New(), card.ID, native)
		if err != nil || hasCyrillic(got.ExampleTranslation) || got.ExampleTranslation != "Translated." {
			t.Errorf("%s: %+v %v", native, got, err)
		}
		if got.Translation != card.Translation {
			t.Errorf("%s: the word changed to %q", native, got.Translation)
		}
	}
}

func TestTranslate_AWrongLanguageCacheRowIsNotUsedForTheExample(t *testing.T) {
	// Old rows: the creation cache entry of an uz card holds its Russian example.
	card := fearCard()
	cache := &memTrCache{rows: map[string][2]string{card.ID.String() + "uz": {"qo‘rquv", "Мне страшно."}}}
	ai := &recAI{out: "x", ex: "Men qo‘rqaman."}
	got, _ := NewTranslationService(fakeCards{card: card}, cache, ai).Translate(context.Background(), uuid.New(), card.ID, "uz")
	if got.ExampleTranslation != "Men qo‘rqaman." || len(ai.reqs) != 1 {
		t.Errorf("%+v, AI calls %d", got, len(ai.reqs))
	}
	if cache.rows[card.ID.String()+"uz"][1] != "Men qo‘rqaman." {
		t.Errorf("the bad row must be replaced: %v", cache.rows[card.ID.String()+"uz"])
	}
}

func TestTranslate_ACardWithoutAnExample_NeedsNothingElse(t *testing.T) {
	card := fearCard()
	card.ExampleSentence, card.ExampleTranslation, card.ExampleTranslationLanguage = "", "", nil
	cache := &memTrCache{rows: map[string][2]string{}}
	ai := &recAI{out: "must not be asked"}
	got, err := NewTranslationService(fakeCards{card: card}, cache, ai).Translate(context.Background(), uuid.New(), card.ID, "uz")
	if err != nil || got != (CardTranslation{Translation: "qo‘rquv"}) || len(ai.reqs) != 0 || cache.gets != 0 {
		t.Errorf("%+v %v, AI %d, cache reads %d", got, err, len(ai.reqs), cache.gets)
	}
}

func TestTranslate_WhenTheExampleCannotBeTranslated_TheWordStillComes_NeverTheRussianText(t *testing.T) {
	card := fearCard()
	cache := &memTrCache{rows: map[string][2]string{}}
	// AI fails
	ai := &recAI{err: errors.New("overloaded")}
	got, err := NewTranslationService(fakeCards{card: card}, cache, ai).Translate(context.Background(), uuid.New(), card.ID, "uz")
	if err != nil || got != (CardTranslation{Translation: "qo‘rquv"}) {
		t.Errorf("AI failure: %+v %v", got, err)
	}
	// no AI configured
	got, err = NewTranslationService(fakeCards{card: card}, cache, nil).Translate(context.Background(), uuid.New(), card.ID, "uz")
	if err != nil || got != (CardTranslation{Translation: "qo‘rquv"}) {
		t.Errorf("no AI: %+v %v", got, err)
	}
	// but with nothing at all to show for the word, it is an error as before
	other := fearCard()
	if _, err := NewTranslationService(fakeCards{card: other}, cache, nil).Translate(context.Background(), uuid.New(), other.ID, "en"); !errors.Is(err, domain.ErrUnavailable) {
		t.Errorf("no word, no AI: %v", err)
	}
	if _, err := NewTranslationService(fakeCards{card: other}, cache, &recAI{err: errors.New("x")}).Translate(context.Background(), uuid.New(), other.ID, "en"); !errors.Is(err, domain.ErrUpstream) {
		t.Errorf("no word, AI fails: %v", err)
	}
}
