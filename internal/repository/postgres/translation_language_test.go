package postgres

import (
	"context"
	"errors"
	"io/fs"
	"testing"

	"github.com/google/uuid"

	"learnwords/internal/domain"
	"learnwords/internal/service"
	"learnwords/migrations"
)

// neverAI fails the test if training ever asks AI.
type neverAI struct{ t *testing.T }

func (n neverAI) TranslateCard(_ context.Context, req domain.TranslateRequest) (string, string, error) {
	n.t.Errorf("AI was called for %+v", req)
	return "AI GUESS", "", nil
}

type recordingAI struct{ reqs []domain.TranslateRequest }

func (r *recordingAI) TranslateCard(_ context.Context, req domain.TranslateRequest) (string, string, error) {
	r.reqs = append(r.reqs, req)
	return "tinch", "", nil
}

type trFixture struct {
	shareFixture
	contexts *ContextRepository
	cards    *WordCardRepository
	cache    *WordTranslationRepository
}

func newTrFixture(t *testing.T) trFixture {
	f := newShareFixture(t)
	return trFixture{f, NewContextRepository(f.pool), NewWordCardRepository(f.pool), NewWordTranslationRepository(f.pool)}
}

func (f trFixture) training(t *testing.T, ai service.WordTranslator, word uuid.UUID, lang string) service.CardTranslation {
	t.Helper()
	svc := service.NewTranslationService(f.cards, f.cache, ai)
	got, err := svc.Translate(context.Background(), f.user, word, lang)
	if err != nil {
		t.Fatal(err)
	}
	return got
}

func (f trFixture) cached(t *testing.T, word uuid.UUID) map[string]string {
	rows, err := f.pool.Query(context.Background(), `SELECT language, translation FROM word_translations WHERE word_id = $1`, word)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	out := map[string]string{}
	for rows.Next() {
		var l, tr string
		if err := rows.Scan(&l, &tr); err != nil {
			t.Fatal(err)
		}
		out[l] = tr
	}
	return out
}

func (f trFixture) createWord(t *testing.T, uiLang, word, meaning string) domain.WordCard {
	t.Helper()
	svc := service.NewContextService(f.contexts, f.cards, service.Providers{})
	ctx := domain.WithTranslationLang(domain.WithLang(context.Background(), "de"), uiLang)
	res, err := svc.Create(ctx, f.user, service.CreateContextInput{
		Text: word, Meaning: meaning, ExampleSentence: "Das Kind ist ___.", ExampleTranslation: "Ребёнок спокоен.",
	})
	if err != nil {
		t.Fatal(err)
	}
	return res.Cards[0]
}

// The reported bug: a card added with "тихий, спокойный" must be trained with exactly that.
func TestTraining_CardAddedInRu_UsesTheCardTranslationWithoutAI(t *testing.T) {
	f := newTrFixture(t)
	card := f.createWord(t, "ru", "still", "тихий, спокойный")

	if card.TranslationLanguage == nil || *card.TranslationLanguage != "ru" {
		t.Fatalf("translation_language: %v", card.TranslationLanguage)
	}
	if got := f.cached(t, card.ID); got["ru"] != "тихий, спокойный" {
		t.Errorf("the translation is also the cache entry of its language: %v", got)
	}
	// An older wrong AI answer sits in the cache — it must not be shown.
	f.exec(t, `UPDATE word_translations SET translation = 'ещё' WHERE word_id = $1`, card.ID)

	got := f.training(t, neverAI{t}, card.ID, "ru")
	if got.Translation != "тихий, спокойный" || got.ExampleTranslation != "Ребёнок спокоен." {
		t.Errorf("training shows %+v", got)
	}
}

func TestCreate_TranslationLanguageFollowsWhoWroteIt(t *testing.T) {
	f := newTrFixture(t)
	lang := func(c domain.WordCard) string {
		if c.TranslationLanguage == nil {
			return "<nil>"
		}
		return *c.TranslationLanguage
	}
	if c := f.createWord(t, "uz", "still", "tinch"); lang(c) != "uz" {
		t.Errorf("typed by an Uzbek-interface user: %s", lang(c))
	}
	// A card always carries the user's own translation: none typed is refused, nothing is saved.
	svc := service.NewContextService(f.contexts, f.cards, service.Providers{})
	ctx := domain.WithTranslationLang(domain.WithLang(context.Background(), "de"), "uz")
	if _, err := svc.Create(ctx, f.user, service.CreateContextInput{Text: "danke"}); !errors.Is(err, domain.ErrValidation) {
		t.Errorf("no translation: %v", err)
	}
}

func TestTraining_OtherLanguage_AiGetsTheMeaningAndTheFilledExample_AndTheAnswerIsCached(t *testing.T) {
	f := newTrFixture(t)
	card := f.createWord(t, "ru", "still", "тихий, спокойный")
	ai := &recordingAI{}
	if got := f.training(t, ai, card.ID, "uz"); got.Translation != "tinch" {
		t.Fatalf("%+v", got)
	}
	f.training(t, ai, card.ID, "uz")
	if len(ai.reqs) != 1 {
		t.Fatalf("AI calls: %d", len(ai.reqs))
	}
	if r := ai.reqs[0]; r.KnownMeaning != "тихий, спокойный" || r.KnownMeaningLang != "ru" || r.ExampleSentence != "Das Kind ist still." {
		t.Errorf("request: %+v", r)
	}
}

func TestEdit_TranslationChange_TrainingShowsItImmediately_OtherLanguagesDropped(t *testing.T) {
	f := newTrFixture(t)
	ctx := context.Background()
	card := f.createWord(t, "ru", "still", "ещё")
	ai := &recordingAI{}
	f.training(t, ai, card.ID, "uz") // an uz cache row exists now
	if len(f.cached(t, card.ID)) != 2 {
		t.Fatalf("setup: %v", f.cached(t, card.ID))
	}

	// The user fixes the meaning while the interface is Russian.
	edit := domain.WithTranslationLang(ctx, "ru")
	if _, err := f.cards.UpdateContent(edit, f.user, card.ID, domain.WordCardUpdate{Translation: ptr("тихий, спокойный")}); err != nil {
		t.Fatal(err)
	}
	if got := f.training(t, neverAI{t}, card.ID, "ru"); got.Translation != "тихий, спокойный" {
		t.Errorf("training shows %+v right after the edit", got)
	}
	if got := f.cached(t, card.ID); len(got) != 1 || got["ru"] != "тихий, спокойный" {
		t.Errorf("cache after the edit: %v (uz must be dropped, ru replaced)", got)
	}
	// uz is regenerated from the NEW meaning.
	f.training(t, ai, card.ID, "uz")
	if last := ai.reqs[len(ai.reqs)-1]; last.KnownMeaning != "тихий, спокойный" {
		t.Errorf("regeneration used %q", last.KnownMeaning)
	}

	// Editing the translation under another interface language re-labels the card.
	if _, err := f.cards.UpdateContent(domain.WithTranslationLang(ctx, "uz"), f.user, card.ID, domain.WordCardUpdate{Translation: ptr("tinch, xotirjam")}); err != nil {
		t.Fatal(err)
	}
	var tl string
	f.pool.QueryRow(ctx, `SELECT translation_language FROM word_cards WHERE id = $1`, card.ID).Scan(&tl) //nolint:errcheck
	if tl != "uz" {
		t.Errorf("translation_language %q, want uz", tl)
	}
	if got := f.cached(t, card.ID); len(got) != 1 || got["uz"] != "tinch, xotirjam" {
		t.Errorf("cache: %v", got)
	}
	if got := f.training(t, neverAI{t}, card.ID, "uz"); got.Translation != "tinch, xotirjam" {
		t.Errorf("uz training: %+v", got)
	}
}

func TestEdit_WordOrExampleChange_DropsEveryCachedTranslation(t *testing.T) {
	f := newTrFixture(t)
	ctx := domain.WithTranslationLang(context.Background(), "ru")
	card := f.createWord(t, "ru", "still", "тихий")
	f.exec(t, `INSERT INTO word_translations (word_id, language, translation) VALUES ($1, 'en', 'quiet')`, card.ID)

	// Unrelated edit (pronunciation) leaves the cache alone.
	if _, err := f.cards.UpdateContent(ctx, f.user, card.ID, domain.WordCardUpdate{Transcription: ptr("[ʃtɪl]")}); err != nil {
		t.Fatal(err)
	}
	if len(f.cached(t, card.ID)) != 2 {
		t.Errorf("a pronunciation edit touched the cache: %v", f.cached(t, card.ID))
	}
	// Same values as before: nothing changed, cache stays.
	if _, err := f.cards.UpdateContent(ctx, f.user, card.ID, domain.WordCardUpdate{Word: ptr("still"), Translation: ptr("тихий")}); err != nil {
		t.Fatal(err)
	}
	if len(f.cached(t, card.ID)) != 2 {
		t.Errorf("saving unchanged values touched the cache: %v", f.cached(t, card.ID))
	}

	if _, err := f.cards.UpdateContent(ctx, f.user, card.ID, domain.WordCardUpdate{ExampleSentence: ptr("Es ist ___ hier.")}); err != nil {
		t.Fatal(err)
	}
	if got := f.cached(t, card.ID); len(got) != 0 {
		t.Errorf("example changed, cache must be empty: %v", got)
	}
	// The card's own translation still wins in its language, with no AI.
	if got := f.training(t, neverAI{t}, card.ID, "ru"); got.Translation != "тихий" {
		t.Errorf("%+v", got)
	}

	f.exec(t, `INSERT INTO word_translations (word_id, language, translation) VALUES ($1, 'en', 'quiet')`, card.ID)
	if _, err := f.cards.UpdateContent(ctx, f.user, card.ID, domain.WordCardUpdate{Word: ptr("Stille")}); err != nil {
		t.Fatal(err)
	}
	if got := f.cached(t, card.ID); len(got) != 0 {
		t.Errorf("word changed, cache must be empty: %v", got)
	}
}

func TestUpdateExample_KeepsTheOwnLanguageCacheInSync(t *testing.T) {
	f := newTrFixture(t)
	card := f.createWord(t, "ru", "still", "тихий")
	f.exec(t, `INSERT INTO word_translations (word_id, language, translation, example_translation) VALUES ($1, 'en', 'quiet', 'old')`, card.ID)

	if err := f.cards.UpdateExample(context.Background(), f.user, card.ID, "Sei ___!", "Тише!"); err != nil {
		t.Fatal(err)
	}
	var ex string
	f.pool.QueryRow(context.Background(), `SELECT example_translation FROM word_translations WHERE word_id = $1 AND language = 'ru'`, card.ID).Scan(&ex) //nolint:errcheck
	if ex != "Тише!" {
		t.Errorf("ru example in the cache: %q", ex)
	}
	if got := f.cached(t, card.ID); got["en"] != "" {
		t.Errorf("a stale en row of the old example survived: %v", got)
	}
}

func TestWordFixAccept_DropsCachedTranslationsButTheCardKeepsItsOwn(t *testing.T) {
	f := newTrFixture(t)
	card := f.createWord(t, "ru", "Sfit", "ручка")
	f.exec(t, `INSERT INTO word_translations (word_id, language, translation) VALUES ($1, 'en', 'pen')`, card.ID)
	fixID := uuid.New()
	f.exec(t, `INSERT INTO word_fix_suggestions (id, user_id, word_id, original_word, suggested_word, lemma, article, part_of_speech)
		VALUES ($1, $2, $3, 'Sfit', 'der Stift', 'Stift', 'der', 'noun')`, fixID, f.user, card.ID)

	if err := NewWordFixRepository(f.pool).Accept(context.Background(), f.user, fixID); err != nil {
		t.Fatal(err)
	}
	if got := f.cached(t, card.ID); len(got) != 0 {
		t.Errorf("cache after the word changed: %v", got)
	}
	var tl string
	f.pool.QueryRow(context.Background(), `SELECT translation_language FROM word_cards WHERE id = $1`, card.ID).Scan(&tl) //nolint:errcheck
	if tl != "ru" {
		t.Errorf("accepting a spelling fix must not relabel the translation: %q", tl)
	}
	if got := f.training(t, neverAI{t}, card.ID, "ru"); got.Translation != "ручка" {
		t.Errorf("%+v", got)
	}
}

func TestImport_KeepsTheSourceTranslationLanguageAndCache(t *testing.T) {
	owner := newTrFixture(t)
	me := newTrFixture(t)
	ctx := context.Background()
	src := owner.folder(t, owner.user)
	w := owner.sourceWord(t, owner.user, src, "still", "тихий")
	owner.exec(t, `UPDATE word_cards SET translation_language = 'ru' WHERE id = $1`, w)
	owner.exec(t, `DELETE FROM word_translations WHERE word_id = $1`, w) // the source's cache lacks its own row
	tok, _ := owner.repo.EnableShare(ctx, owner.user, src)

	res, err := me.repo.ImportShared(ctx, me.user, "de", tok, 100)
	if err != nil || res.Added != 1 {
		t.Fatal(res, err)
	}
	var id uuid.UUID
	var tl string
	me.pool.QueryRow(ctx, `SELECT id, translation_language FROM word_cards WHERE folder_id = $1`, res.FolderID).Scan(&id, &tl) //nolint:errcheck
	if tl != "ru" {
		t.Errorf("translation_language %q — the text is in the source's language, whoever imports it", tl)
	}
	if got := me.cached(t, id); got["ru"] != "тихий" {
		t.Errorf("cache of the copy: %v", got)
	}
	if got := me.training(t, neverAI{t}, id, "ru"); got.Translation != "тихий" {
		t.Errorf("%+v", got)
	}
}

// Migration 000029 on data as it was before: backfills Cyrillic cards and repairs wrong cache rows.
func TestMigration29_BackfillAndRepair(t *testing.T) {
	f := newTrFixture(t)
	ctx := context.Background()
	cyr := f.word(t, f.user, nil, f.moveNow())
	f.exec(t, `UPDATE word_cards SET translation = 'тихий, спокойный', example_translation = 'Ребёнок спокоен.', translation_language = NULL WHERE id = $1`, cyr)
	f.exec(t, `INSERT INTO word_translations (word_id, language, translation, example_translation) VALUES ($1, 'ru', 'ещё', 'wrong')
		ON CONFLICT (word_id, language) DO UPDATE SET translation = 'ещё', example_translation = 'wrong'`, cyr)
	f.exec(t, `INSERT INTO word_translations (word_id, language, translation) VALUES ($1, 'en', 'quiet')`, cyr)

	lat := f.word(t, f.user, nil, f.moveNow())
	f.exec(t, `UPDATE word_cards SET translation = 'tinch', translation_language = NULL WHERE id = $1`, lat)

	sql, err := fs.ReadFile(migrations.FS, "000029_translation_language.up.sql")
	if err != nil {
		t.Fatal(err)
	}
	f.exec(t, string(sql))
	f.exec(t, string(sql)) // safe to run twice

	var tl *string
	f.pool.QueryRow(ctx, `SELECT translation_language FROM word_cards WHERE id = $1`, cyr).Scan(&tl) //nolint:errcheck
	if tl == nil || *tl != "ru" {
		t.Errorf("Cyrillic card: %v", tl)
	}
	f.pool.QueryRow(ctx, `SELECT translation_language FROM word_cards WHERE id = $1`, lat).Scan(&tl) //nolint:errcheck
	if tl != nil {
		t.Errorf("a non-Cyrillic card must stay unknown, got %v", *tl)
	}
	got := f.cached(t, cyr)
	if got["ru"] != "тихий, спокойный" || got["en"] != "quiet" {
		t.Errorf("repaired cache: %v", got)
	}
	var ex string
	f.pool.QueryRow(ctx, `SELECT example_translation FROM word_translations WHERE word_id = $1 AND language = 'ru'`, cyr).Scan(&ex) //nolint:errcheck
	if ex != "Ребёнок спокоен." {
		t.Errorf("example translation repaired: %q", ex)
	}
}
