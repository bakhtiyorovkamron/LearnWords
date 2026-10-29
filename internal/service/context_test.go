package service

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/google/uuid"

	"learnwords/internal/domain"
)

type fakeContexts struct {
	saved   []domain.WordCard
	context domain.Context
}

func (f *fakeContexts) CreateWithCards(_ context.Context, c *domain.Context, cards []domain.WordCard) error {
	f.context = *c
	f.saved = append(f.saved, cards...)
	return nil
}

func newContextSvc() (*ContextService, *fakeContexts) {
	repo := &fakeContexts{}
	return NewContextService(repo, nil, Providers{}), repo
}

func ctxFor(ui string) context.Context {
	return domain.WithTranslationLang(domain.WithLang(context.Background(), "de"), ui)
}

func TestCreate_AMultiWordPhraseIsOneCardWithTheUsersTranslation(t *testing.T) {
	svc, repo := newContextSvc()
	res, err := svc.Create(ctxFor("ru"), uuid.New(), CreateContextInput{
		Text: "  Ich   freue mich\tauf das Wochenende ", Meaning: " Я радуюсь выходным ", Pronunciation: " [ихь] ",
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Cards) != 1 || len(repo.saved) != 1 {
		t.Fatalf("cards: %d saved, %d returned — a phrase is one card", len(repo.saved), len(res.Cards))
	}
	c := res.Cards[0]
	if c.Word != "Ich freue mich auf das Wochenende" {
		t.Errorf("word %q: spaces must be collapsed", c.Word)
	}
	if c.Translation != "Я радуюсь выходным" || c.Transcription != "[ихь]" {
		t.Errorf("translation %q, transcription %q must be exactly the user's", c.Translation, c.Transcription)
	}
	if c.AudioURL != nil {
		t.Errorf("no audio is made: %v", *c.AudioURL)
	}
	if c.TranslationLanguage == nil || *c.TranslationLanguage != "ru" {
		t.Errorf("translation language %v", c.TranslationLanguage)
	}
	if res.Context.SourceText != c.Word || res.Context.Meaning != "Я радуюсь выходным" {
		t.Errorf("context %+v", res.Context)
	}
}

func TestCreate_Limits(t *testing.T) {
	svc, repo := newContextSvc()
	for name, in := range map[string]CreateContextInput{
		"101 characters": {Text: strings.Repeat("я", 101), Meaning: "x"},
		"empty text":     {Text: "   ", Meaning: "x"},
		"no meaning":     {Text: "Hund"},
		"blank meaning":  {Text: "Hund", Meaning: "  "},
		"meaning > 500":  {Text: "Hund", Meaning: strings.Repeat("a", 501)},
		"example > 500":  {Text: "Hund", Meaning: "собака", ExampleSentence: strings.Repeat("a", 501)},
	} {
		if _, err := svc.Create(ctxFor("ru"), uuid.New(), in); !errors.Is(err, domain.ErrValidation) {
			t.Errorf("%s: %v", name, err)
		}
	}
	if len(repo.saved) != 0 {
		t.Errorf("invalid input saved %d cards", len(repo.saved))
	}
	if _, err := svc.Create(ctxFor("ru"), uuid.New(), CreateContextInput{Text: strings.Repeat("я", 100), Meaning: "x"}); err != nil {
		t.Errorf("exactly 100 characters is fine: %v", err)
	}
}

func TestCreate_VariantsStayOneCard(t *testing.T) {
	svc, _ := newContextSvc()
	res, err := svc.Create(ctxFor("ru"), uuid.New(), CreateContextInput{Text: "der Samstag / der Sonnabend", Meaning: "суббота"})
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Cards) != 1 || res.Cards[0].Word != "der Samstag / der Sonnabend" {
		t.Errorf("%+v", res.Cards)
	}
}
