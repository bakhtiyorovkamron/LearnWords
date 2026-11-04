package postgres

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"

	"learnwords/internal/domain"
	"learnwords/internal/service"
)

func (f trFixture) gapWord(t *testing.T, answer string) domain.WordCard {
	t.Helper()
	svc := service.NewContextService(f.contexts, f.cards, service.Providers{})
	ctx := domain.WithTranslationLang(domain.WithLang(context.Background(), "de"), "ru")
	res, err := svc.Create(ctx, f.user, service.CreateContextInput{
		Text: "schmecken", Meaning: "быть на вкус", ExampleSentence: "Die Suppe ___ sehr gut.",
		ExampleTranslation: "Суп очень вкусный.", ExampleGapAnswer: answer,
	})
	if err != nil {
		t.Fatal(err)
	}
	return res.Cards[0]
}

func (f trFixture) storedGap(t *testing.T, id uuid.UUID) *string {
	t.Helper()
	var v *string
	if err := f.pool.QueryRow(context.Background(), `SELECT example_gap_answer FROM word_cards WHERE id = $1`, id).Scan(&v); err != nil {
		t.Fatal(err)
	}
	return v
}

func TestExampleGapAnswer_RoundTripsEverywhereACardIsRead(t *testing.T) {
	f := newTrFixture(t)
	ctx := context.Background()
	card := f.gapWord(t, " schmeckt ")
	if card.ExampleGapAnswer != "schmeckt" {
		t.Fatalf("service must trim it: %q", card.ExampleGapAnswer)
	}

	got, err := f.cards.GetByID(ctx, f.user, card.ID)
	if err != nil || got.ExampleGapAnswer != "schmeckt" {
		t.Errorf("GetByID: %q, %v", got.ExampleGapAnswer, err)
	}
	list, _, err := f.cards.ListCollection(ctx, f.user, domain.CollectionFilter{Limit: 10})
	if err != nil || len(list) != 1 || list[0].ExampleGapAnswer != "schmeckt" {
		t.Errorf("collection: %+v, %v", list, err)
	}
	due, err := NewReviewRepository(f.pool).ListDue(ctx, f.user, time.Now().UTC(), 10, nil)
	if err != nil || len(due) != 1 || due[0].ExampleGapAnswer != "schmeckt" || !due[0].HasExample {
		t.Errorf("review: %+v, %v", due, err)
	}
}

func TestExampleGapAnswer_UnknownIsNullAndEmptyInJSONTerms(t *testing.T) {
	f := newTrFixture(t)
	card := f.gapWord(t, "")
	if v := f.storedGap(t, card.ID); v != nil {
		t.Errorf("an unknown form must be NULL, got %q", *v)
	}
	got, _ := f.cards.GetByID(context.Background(), f.user, card.ID)
	if got.ExampleGapAnswer != "" {
		t.Errorf("got %q", got.ExampleGapAnswer)
	}
}

func TestExampleGapAnswer_NotStoredForASentenceWithoutAGap(t *testing.T) {
	f := newTrFixture(t)
	svc := service.NewContextService(f.contexts, f.cards, service.Providers{})
	ctx := domain.WithTranslationLang(domain.WithLang(context.Background(), "de"), "ru")
	res, err := svc.Create(ctx, f.user, service.CreateContextInput{
		Text: "Haus", Meaning: "дом", ExampleSentence: "Das Haus ist alt.", ExampleGapAnswer: "Haus",
	})
	if err != nil {
		t.Fatal(err)
	}
	if v := f.storedGap(t, res.Cards[0].ID); v != nil {
		t.Errorf("no gap in the sentence, yet stored %q", *v)
	}
}

func TestExampleGapAnswer_UpdateContent(t *testing.T) {
	f := newTrFixture(t)
	ctx := context.Background()
	card := f.gapWord(t, "schmeckt")
	str := func(s string) *string { return &s }

	// an edit of something else keeps it
	if _, err := f.cards.UpdateContent(ctx, f.user, card.ID, domain.WordCardUpdate{Transcription: str("[ʃmɛkn̩]")}); err != nil {
		t.Fatal(err)
	}
	if v := f.storedGap(t, card.ID); v == nil || *v != "schmeckt" {
		t.Errorf("unrelated edit lost the form: %v", v)
	}
	// a new sentence without a new form: the old form no longer belongs to it
	if _, err := f.cards.UpdateContent(ctx, f.user, card.ID, domain.WordCardUpdate{ExampleSentence: str("Das Eis ___ süß.")}); err != nil {
		t.Fatal(err)
	}
	if v := f.storedGap(t, card.ID); v != nil {
		t.Errorf("stale form kept for a new sentence: %q", *v)
	}
	// sentence and form together
	c, err := f.cards.UpdateContent(ctx, f.user, card.ID, domain.WordCardUpdate{ExampleSentence: str("Das Eis ___ süß."), ExampleGapAnswer: str("schmeckt")})
	if err != nil || c.ExampleGapAnswer != "schmeckt" {
		t.Fatalf("returned card: %+v, %v", c, err)
	}
	// an explicit empty value clears it
	if _, err := f.cards.UpdateContent(ctx, f.user, card.ID, domain.WordCardUpdate{ExampleGapAnswer: str("")}); err != nil {
		t.Fatal(err)
	}
	if v := f.storedGap(t, card.ID); v != nil {
		t.Errorf("empty must clear: %q", *v)
	}
}

func TestExampleGapAnswer_UpdateExampleStoresTheGeneratedForm(t *testing.T) {
	f := newTrFixture(t)
	card := f.gapWord(t, "")
	if err := f.cards.UpdateExample(context.Background(), f.user, card.ID, "Sie ___ gern.", "kocht", "Она любит готовить.", "ru"); err != nil {
		t.Fatal(err)
	}
	if v := f.storedGap(t, card.ID); v == nil || *v != "kocht" {
		t.Errorf("got %v", v)
	}
}

func TestExampleGapAnswer_CopiedByAFolderImport(t *testing.T) {
	owner := newShareFixture(t)
	me := newShareFixture(t)
	ctx := context.Background()
	src := owner.folder(t, owner.user)
	id := owner.sourceWord(t, owner.user, src, "schmecken", "быть на вкус")
	owner.exec(t, `UPDATE word_cards SET example_sentence = 'Die Suppe ___ gut.', example_gap_answer = 'schmeckt' WHERE id = $1`, id)
	tok, _ := owner.repo.EnableShare(ctx, owner.user, src)

	res, err := me.repo.ImportShared(ctx, me.user, "de", tok, 100)
	if err != nil || res.Added != 1 {
		t.Fatalf("import: %+v, %v", res, err)
	}
	var v *string
	if err := me.pool.QueryRow(ctx, `SELECT example_gap_answer FROM word_cards WHERE user_id = $1`, me.user).Scan(&v); err != nil {
		t.Fatal(err)
	}
	if v == nil || *v != "schmeckt" {
		t.Errorf("imported card lost the form: %v", v)
	}
}
