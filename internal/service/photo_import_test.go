package service

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/google/uuid"

	"learnwords/internal/domain"
)

var pngBytes = append([]byte("\x89PNG\r\n\x1a\n"), make([]byte, 64)...)

type fakeReader struct {
	words []domain.PhotoWord
	err   error
	calls int
}

func (f *fakeReader) ExtractPhotoWords(context.Context, []byte, string) ([]domain.PhotoWord, error) {
	f.calls++
	return f.words, f.err
}

type fakeExists map[string]bool

func (f fakeExists) HasWord(_ context.Context, _ uuid.UUID, forms ...string) (bool, error) {
	for _, x := range forms {
		if f[strings.ToLower(x)] {
			return true, nil
		}
	}
	return false, nil
}

func sp(s string) *string { return &s }

type photoEnv struct {
	svc   *PhotoImportService
	ai    *fakeReader
	feats *FeatureService
	user  uuid.UUID
}

func newPhotoEnv(words []domain.PhotoWord, aiErr error) photoEnv {
	ai := &fakeReader{words: words, err: aiErr}
	feats := NewFeatureService(newMemFeatureRepo())
	return photoEnv{NewPhotoImportService(ai, fakeExists{"katze": true}, feats), ai, feats, uuid.New()}
}

func (e photoEnv) used(t *testing.T) int {
	t.Helper()
	st, err := e.feats.State(context.Background(), e.user, domain.FeaturePhotoImport)
	if err != nil {
		t.Fatal(err)
	}
	return st.UsedToday
}

func TestPhotoImport_OnePhotoOneUnit_ResultCleaned(t *testing.T) {
	e := newPhotoEnv([]domain.PhotoWord{
		{Word: " Hund ", Article: sp("der"), WordType: "noun", Translation: "собака"},
		{Word: "Hund", Article: sp("der"), WordType: "noun", Translation: "пёс"}, // duplicate
		{Word: "Katze", Article: sp("die"), WordType: "noun", Translation: "кошка"},
		{Word: "laufen", Article: sp("das"), WordType: "verb", Translation: "бежать"}, // article only for nouns
		{Word: "", Translation: "пусто"},
		{Word: "Baum", WordType: "noun", Translation: ""},
	}, nil)
	res, err := e.svc.Import(context.Background(), e.user, pngBytes)
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Words) != 3 {
		t.Fatalf("words: %+v", res.Words)
	}
	if res.Words[0].FullWord != "der Hund" || res.Words[0].AlreadyAdded {
		t.Errorf("first: %+v", res.Words[0])
	}
	if !res.Words[1].AlreadyAdded || res.Words[1].FullWord != "die Katze" {
		t.Errorf("an existing word is flagged (matched without the article): %+v", res.Words[1])
	}
	if res.Words[2].FullWord != "laufen" || res.Words[2].Article != nil {
		t.Errorf("verb: %+v", res.Words[2])
	}
	if res.Remaining == nil || *res.Remaining != 3 || e.used(t) != 1 {
		t.Errorf("one photo = one unit: remaining %v, used %d", res.Remaining, e.used(t))
	}
}

func TestPhotoImport_AIFailureRefunds(t *testing.T) {
	e := newPhotoEnv(nil, errors.New("boom"))
	_, err := e.svc.Import(context.Background(), e.user, pngBytes)
	if !errors.Is(err, domain.ErrUpstream) {
		t.Fatalf("error: %v", err)
	}
	if e.ai.calls != 1 || e.used(t) != 0 {
		t.Errorf("calls %d, used %d: a failed call must not cost quota", e.ai.calls, e.used(t))
	}
}

func TestPhotoImport_LimitAndSwitch_StopBeforeTheAI(t *testing.T) {
	ctx := context.Background()
	e := newPhotoEnv([]domain.PhotoWord{{Word: "Hund", Translation: "собака"}}, nil)
	for range 4 {
		if _, err := e.svc.Import(ctx, e.user, pngBytes); err != nil {
			t.Fatal(err)
		}
	}
	_, err := e.svc.Import(ctx, e.user, pngBytes)
	if n, ok := domain.DailyLimitOf(err); !errors.Is(err, domain.ErrDailyLimit) || !ok || n != 4 {
		t.Fatalf("5th photo: %v", err)
	}
	if e.ai.calls != 4 {
		t.Errorf("the AI was called %d times, want 4", e.ai.calls)
	}

	e2 := newPhotoEnv(nil, nil)
	_ = e2.feats.Set(ctx, e2.user, domain.FeaturePhotoImport, false, nil)
	if _, err := e2.svc.Import(ctx, e2.user, pngBytes); !errors.Is(err, domain.ErrFeatureDisabled) || e2.ai.calls != 0 {
		t.Errorf("disabled: %v, calls %d", err, e2.ai.calls)
	}
}

func TestPhotoImport_RefusedInputIsNeverCharged(t *testing.T) {
	ctx := context.Background()
	e := newPhotoEnv(nil, nil)
	for name, img := range map[string][]byte{
		"empty":   nil,
		"text":    []byte("hello, this is not an image"),
		"pdf":     []byte("%PDF-1.4 ..."),
		"too big": append([]byte("\x89PNG\r\n\x1a\n"), make([]byte, MaxPhotoBytes)...),
	} {
		if _, err := e.svc.Import(ctx, e.user, img); !errors.Is(err, domain.ErrValidation) {
			t.Errorf("%s: %v", name, err)
		}
	}
	noAI := NewPhotoImportService(nil, fakeExists{}, e.feats)
	if _, err := noAI.Import(ctx, e.user, pngBytes); !errors.Is(err, domain.ErrUnavailable) {
		t.Errorf("no API key: %v", err)
	}
	if e.ai.calls != 0 || e.used(t) != 0 {
		t.Errorf("calls %d, used %d", e.ai.calls, e.used(t))
	}
}

func TestPhotoImport_CapsTheList(t *testing.T) {
	var many []domain.PhotoWord
	for i := range 80 {
		many = append(many, domain.PhotoWord{Word: strings.Repeat("a", i+1), Translation: "x"})
	}
	e := newPhotoEnv(many, nil)
	res, err := e.svc.Import(context.Background(), e.user, pngBytes)
	if err != nil || len(res.Words) != maxPhotoWords {
		t.Errorf("%d words, %v", len(res.Words), err)
	}
}
