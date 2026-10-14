package service

import (
	"context"
	"errors"
	"sync"
	"testing"

	"learnwords/internal/domain"
)

func strp(s string) *string { return &s }

// fakeWordChecker answers from a table and counts calls per input.
type fakeWordChecker struct {
	mu      sync.Mutex
	answers map[string][]domain.WordCheck // successive answers per input (last one repeats)
	calls   map[string]int
}

func newFakeWordChecker() *fakeWordChecker {
	return &fakeWordChecker{answers: map[string][]domain.WordCheck{}, calls: map[string]int{}}
}

func (f *fakeWordChecker) CheckWord(_ context.Context, input, _ string) (domain.WordCheck, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	n := f.calls[input]
	f.calls[input]++
	list := f.answers[input]
	if len(list) == 0 {
		return domain.WordCheck{}, errors.New("no answer")
	}
	if n >= len(list) {
		n = len(list) - 1
	}
	return list[n], nil
}

type memWordCheckCache struct{ m map[string]domain.WordCheck }

func (c *memWordCheckCache) Get(_ context.Context, key string) (domain.WordCheck, bool, error) {
	w, ok := c.m[key]
	return w, ok, nil
}
func (c *memWordCheckCache) Put(_ context.Context, key string, w domain.WordCheck) error {
	c.m[key] = w
	return nil
}

func deCtx() context.Context { return domain.WithLang(context.Background(), "de") }

func TestWordCheck_Cases(t *testing.T) {
	ai := newFakeWordChecker()
	ai.answers["Sfit"] = []domain.WordCheck{{Status: "corrected", Lemma: "Stift", Article: strp("der"), Plural: strp("Stifte"), PartOfSpeech: "noun", Translation: "ручка", Reason: "опечатка"}}
	ai.answers["komme"] = []domain.WordCheck{{Status: "corrected", Lemma: "kommen", PartOfSpeech: "verb", Translation: "приходить"}}
	ai.answers["Häuser"] = []domain.WordCheck{{Status: "corrected", Lemma: "Haus", Article: strp("das"), Plural: strp("Häuser"), PartOfSpeech: "noun", Translation: "дом"}}
	ai.answers["das Geld"] = []domain.WordCheck{{Status: "ok", Lemma: "Geld", Article: strp("das"), PartOfSpeech: "noun", Translation: "деньги"}}
	ai.answers["Bis nächste Woche!"] = []domain.WordCheck{{Status: "ok", Lemma: "Bis nächste Woche!", PartOfSpeech: "phrase", Translation: "до следующей недели"}}
	ai.answers["Tisch"] = []domain.WordCheck{{Status: "ok", Lemma: "Tisch", Article: strp("der"), Plural: strp("Tische"), PartOfSpeech: "noun", Translation: "стол"}}
	svc := NewWordCheckService(ai, &memWordCheckCache{m: map[string]domain.WordCheck{}})

	check := func(in string) domain.WordCheck {
		t.Helper()
		w, err := svc.Check(deCtx(), in, "ru")
		if err != nil {
			t.Fatalf("%s: %v", in, err)
		}
		return w
	}
	if w := check("Sfit"); w.Status != domain.CheckCorrected || w.Suggestion() != "der Stift" || *w.Plural != "Stifte" {
		t.Errorf("Sfit: %+v", w)
	}
	if w := check("komme"); w.Status != domain.CheckCorrected || w.Lemma != "kommen" || w.PartOfSpeech != domain.PosVerb {
		t.Errorf("komme: %+v", w)
	}
	if w := check("Häuser"); w.Status != domain.CheckCorrected || w.Suggestion() != "das Haus" || *w.Plural != "Häuser" {
		t.Errorf("Häuser: %+v", w)
	}
	if w := check("das Geld"); w.Status != domain.CheckOK || *w.Article != "das" {
		t.Errorf("das Geld: %+v", w)
	}
	if w := check("Bis nächste Woche!"); w.Status != domain.CheckOK || w.PartOfSpeech != domain.PosPhrase || w.Lemma != "Bis nächste Woche!" {
		t.Errorf("phrase: %+v", w)
	}
	if w := check("Tisch"); w.Status != domain.CheckOK || *w.Article != "der" {
		t.Errorf("Tisch: %+v", w)
	}
}

func TestWordCheck_SecondCheckComesFromCache(t *testing.T) {
	ai := newFakeWordChecker()
	ai.answers["Sfit"] = []domain.WordCheck{{Status: "corrected", Lemma: "Stift", Article: strp("der"), PartOfSpeech: "noun", Translation: "ручка"}}
	svc := NewWordCheckService(ai, &memWordCheckCache{m: map[string]domain.WordCheck{}})

	for i := 0; i < 3; i++ {
		w, err := svc.Check(deCtx(), "  Sfit ", "ru")
		if err != nil || w.Suggestion() != "der Stift" {
			t.Fatalf("check %d: %+v %v", i, w, err)
		}
	}
	if ai.calls["Sfit"] != 1 {
		t.Fatalf("AI called %d times, want 1", ai.calls["Sfit"])
	}
	// Another native language is another cache entry (the translation differs).
	if _, err := svc.Check(deCtx(), "Sfit", "en"); err != nil {
		t.Fatal(err)
	}
	if ai.calls["Sfit"] != 2 {
		t.Fatalf("AI called %d times, want 2", ai.calls["Sfit"])
	}
}

func TestWordCheck_InvalidAnswerRetriedOnceThenUnknown(t *testing.T) {
	ai := newFakeWordChecker()
	bad := domain.WordCheck{Status: "ok", Lemma: "Stift", PartOfSpeech: "noun", Translation: "ручка"} // noun without article
	good := domain.WordCheck{Status: "corrected", Lemma: "Stift", Article: strp("der"), PartOfSpeech: "noun", Translation: "ручка"}
	ai.answers["Sfit"] = []domain.WordCheck{bad, good}
	ai.answers["Stfit"] = []domain.WordCheck{bad}
	cache := &memWordCheckCache{m: map[string]domain.WordCheck{}}
	svc := NewWordCheckService(ai, cache)

	if w, _ := svc.Check(deCtx(), "Sfit", "ru"); w.Status != domain.CheckCorrected || ai.calls["Sfit"] != 2 {
		t.Fatalf("retry: %+v, calls=%d", w, ai.calls["Sfit"])
	}
	w, err := svc.Check(deCtx(), "Stfit", "ru")
	if err != nil || w.Status != domain.CheckUnknown || ai.calls["Stfit"] != 2 {
		t.Fatalf("fallback: %+v %v calls=%d", w, err, ai.calls["Stfit"])
	}
	if _, ok := cache.m[WordCheckKey("de", "ru", "Stfit")]; ok {
		t.Fatal("a fallback 'unknown' must not be cached")
	}
}

func TestWordCheck_Validation(t *testing.T) {
	svc := NewWordCheckService(newFakeWordChecker(), nil)
	if _, err := svc.Check(deCtx(), "  ", "ru"); !errors.Is(err, domain.ErrValidation) {
		t.Errorf("empty: %v", err)
	}
	if _, err := svc.Check(domain.WithLang(context.Background(), "en"), "house", "ru"); !errors.Is(err, domain.ErrValidation) {
		t.Errorf("non-German: %v", err)
	}
	if _, err := NewWordCheckService(nil, nil).Check(deCtx(), "Tisch", "ru"); !errors.Is(err, domain.ErrUnavailable) {
		t.Errorf("no AI: %v", err)
	}
}
