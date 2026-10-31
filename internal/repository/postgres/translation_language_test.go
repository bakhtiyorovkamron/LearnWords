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

type trFixture struct {
	shareFixture
	contexts *ContextRepository
	cards    *WordCardRepository
}

func newTrFixture(t *testing.T) trFixture {
	f := newShareFixture(t)
	return trFixture{f, NewContextRepository(f.pool), NewWordCardRepository(f.pool)}
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

func TestEdit_TranslationChange_OtherLanguagesDropped_CardIsRelabelled(t *testing.T) {
	f := newTrFixture(t)
	ctx := context.Background()
	card := f.createWord(t, "ru", "still", "ещё")
	f.exec(t, `INSERT INTO word_translations (word_id, language, translation) VALUES ($1, 'uz', 'tinch')`, card.ID) // an old cache row of another language
	if len(f.cached(t, card.ID)) != 2 {
		t.Fatalf("setup: %v", f.cached(t, card.ID))
	}

	// The user fixes the meaning while the interface is Russian.
	edit := domain.WithTranslationLang(ctx, "ru")
	if _, err := f.cards.UpdateContent(edit, f.user, card.ID, domain.WordCardUpdate{Translation: ptr("тихий, спокойный")}); err != nil {
		t.Fatal(err)
	}
	if got := f.cached(t, card.ID); len(got) != 1 || got["ru"] != "тихий, спокойный" {
		t.Errorf("cache after the edit: %v (uz must be dropped, ru replaced)", got)
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

	if err := f.cards.UpdateExample(context.Background(), f.user, card.ID, "Sei ___!", "Тише!", "ru"); err != nil {
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

// --- the language of the example translation ------------------------------------------------------

func (f trFixture) exampleLang(t *testing.T, card uuid.UUID) *string {
	t.Helper()
	var lang *string
	if err := f.pool.QueryRow(context.Background(), `SELECT example_translation_language FROM word_cards WHERE id = $1`, card).Scan(&lang); err != nil {
		t.Fatal(err)
	}
	return lang
}

func equalLang(got *string, want string) bool { return got != nil && *got == want }

func TestCreate_StoresTheLanguageTheExampleWasWrittenIn(t *testing.T) {
	f := newTrFixture(t)
	create := func(ui, example string) domain.WordCard {
		svc := service.NewContextService(f.contexts, f.cards, service.Providers{})
		ctx := domain.WithTranslationLang(domain.WithLang(context.Background(), "de"), ui)
		res, err := svc.Create(ctx, f.user, service.CreateContextInput{
			Text: "still" + uuid.NewString()[:4], Meaning: "tinch", ExampleSentence: "Das Kind ist ___.", ExampleTranslation: example,
		})
		if err != nil {
			t.Fatal(err)
		}
		return res.Cards[0]
	}
	if c := create("uz", "Bola tinch."); !equalLang(c.ExampleTranslationLanguage, "uz") || !equalLang(f.exampleLang(t, c.ID), "uz") {
		t.Errorf("a card added from the Uzbek UI: %v / %v", c.ExampleTranslationLanguage, f.exampleLang(t, c.ID))
	}
	if c := create("ru", "Ребёнок спокоен."); !equalLang(f.exampleLang(t, c.ID), "ru") {
		t.Errorf("a card added from the Russian UI: %v", f.exampleLang(t, c.ID))
	}
	if c := create("uz", ""); c.ExampleTranslationLanguage != nil || f.exampleLang(t, c.ID) != nil {
		t.Errorf("no example translation → no language: %v", f.exampleLang(t, c.ID))
	}
}

func TestUpdateExample_StoresItsLanguage_AndKeepsAForeignOneOutOfTheOwnCache(t *testing.T) {
	f := newTrFixture(t)
	card := f.createWord(t, "uz", "still", "tinch") // word: uz
	if err := f.cards.UpdateExample(context.Background(), f.user, card.ID, "Sei ___!", "Тише!", "ru"); err != nil {
		t.Fatal(err)
	}
	if !equalLang(f.exampleLang(t, card.ID), "ru") {
		t.Errorf("example language %v", f.exampleLang(t, card.ID))
	}
	var ex string
	f.pool.QueryRow(context.Background(), `SELECT example_translation FROM word_translations WHERE word_id = $1 AND language = 'uz'`, card.ID).Scan(&ex) //nolint:errcheck
	if ex != "" {
		t.Errorf("the uz cache entry holds the Russian example %q", ex)
	}
	if err := f.cards.UpdateExample(context.Background(), f.user, card.ID, "Sei ___!", "Jim bo‘l!", "uz"); err != nil {
		t.Fatal(err)
	}
	if !equalLang(f.exampleLang(t, card.ID), "uz") {
		t.Errorf("example language %v", f.exampleLang(t, card.ID))
	}
	f.pool.QueryRow(context.Background(), `SELECT example_translation FROM word_translations WHERE word_id = $1 AND language = 'uz'`, card.ID).Scan(&ex) //nolint:errcheck
	if ex != "Jim bo‘l!" {
		t.Errorf("the uz cache entry: %q", ex)
	}
}

func TestEdit_ExampleTranslationGetsTheEditorsLanguage_OtherEditsLeaveItAlone(t *testing.T) {
	f := newTrFixture(t)
	ctx := context.Background()
	card := f.createWord(t, "ru", "still", "тихий") // example: ru
	if !equalLang(f.exampleLang(t, card.ID), "ru") {
		t.Fatalf("setup: %v", f.exampleLang(t, card.ID))
	}
	uz := domain.WithTranslationLang(ctx, "uz")

	// editing only the word's translation under the Uzbek UI: the example is still the Russian one
	if _, err := f.cards.UpdateContent(uz, f.user, card.ID, domain.WordCardUpdate{Translation: ptr("tinch")}); err != nil {
		t.Fatal(err)
	}
	if !equalLang(f.exampleLang(t, card.ID), "ru") {
		t.Errorf("example language %v after a word-only edit, want ru", f.exampleLang(t, card.ID))
	}
	// the same example text saved again changes nothing
	if _, err := f.cards.UpdateContent(uz, f.user, card.ID, domain.WordCardUpdate{ExampleTranslation: ptr("Ребёнок спокоен.")}); err != nil {
		t.Fatal(err)
	}
	if !equalLang(f.exampleLang(t, card.ID), "ru") {
		t.Errorf("an unchanged example was re-labelled: %v", f.exampleLang(t, card.ID))
	}
	// a new example translation written under the Uzbek UI is Uzbek
	if _, err := f.cards.UpdateContent(uz, f.user, card.ID, domain.WordCardUpdate{ExampleTranslation: ptr("Bola tinch.")}); err != nil {
		t.Fatal(err)
	}
	if !equalLang(f.exampleLang(t, card.ID), "uz") {
		t.Errorf("example language %v, want uz", f.exampleLang(t, card.ID))
	}
	// clearing it leaves no language
	if _, err := f.cards.UpdateContent(uz, f.user, card.ID, domain.WordCardUpdate{ExampleTranslation: ptr("")}); err != nil {
		t.Fatal(err)
	}
	if f.exampleLang(t, card.ID) != nil && !equalLang(f.exampleLang(t, card.ID), "uz") {
		t.Errorf("after clearing: %v", f.exampleLang(t, card.ID))
	}
}

func TestImportShared_CopiesTheExampleLanguage_AndKeepsAForeignExampleOutOfTheCache(t *testing.T) {
	owner := newShareFixture(t)
	me := newShareFixture(t)
	ctx := context.Background()
	src := owner.folder(t, owner.user)
	word := owner.sourceWord(t, owner.user, src, "die Angst", "qo‘rquv")
	// an Uzbek word with the old Russian example
	owner.exec(t, `UPDATE word_cards SET translation_language = 'uz', example_translation = 'Мне страшно.', example_translation_language = 'ru' WHERE id = $1`, word)
	owner.exec(t, `DELETE FROM word_translations WHERE word_id = $1`, word)
	tok, _ := owner.repo.EnableShare(ctx, owner.user, src)

	res, err := me.repo.ImportShared(ctx, me.user, "de", tok, 100)
	if err != nil || res.Added != 1 {
		t.Fatalf("%+v %v", res, err)
	}
	var id uuid.UUID
	var exLang, trLang *string
	if err := me.pool.QueryRow(ctx, `SELECT id, example_translation_language, translation_language FROM word_cards WHERE folder_id = $1 AND user_id = $2`,
		res.FolderID, me.user).Scan(&id, &exLang, &trLang); err != nil {
		t.Fatal(err)
	}
	if !equalLang(exLang, "ru") || !equalLang(trLang, "uz") {
		t.Errorf("copied languages: example %v, word %v", exLang, trLang)
	}
	var cachedEx string
	if err := me.pool.QueryRow(ctx, `SELECT example_translation FROM word_translations WHERE word_id = $1 AND language = 'uz'`, id).Scan(&cachedEx); err != nil {
		t.Fatal(err)
	}
	if cachedEx != "" {
		t.Errorf("the uz cache entry got the Russian example %q", cachedEx)
	}
}

// The backfill of migration 000037, run on rows as they were before it.
func TestMigration37_BackfillsTheExampleLanguage(t *testing.T) {
	f := newTrFixture(t)
	ctx := context.Background()
	mk := func(translationLang, example string) uuid.UUID {
		ctxID, id := uuid.New(), uuid.New()
		f.exec(t, `INSERT INTO contexts (id, user_id, source_text) VALUES ($1, $2, 'w')`, ctxID, f.user)
		f.exec(t, `INSERT INTO word_cards (id, context_id, user_id, word, translation, translation_language, example_translation)
			VALUES ($1, $2, $3, 'w', 't', NULLIF($4, ''), $5)`, id, ctxID, f.user, translationLang, example)
		return id
	}
	cyrillicEx := mk("uz", "Мне страшно.") // Cyrillic → ru, whatever the word's language
	latinUz := mk("uz", "Bola tinch.")     // otherwise → the word's language
	latinEn := mk("en", "The child is quiet.")
	latinUnknown := mk("", "Das Kind ist still.") // no language at all → stays unknown
	empty := mk("uz", "   ")                      // nothing to label
	noExample := mk("ru", "")

	up, err := migrations.FS.ReadFile("000037_example_translation_language.up.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.pool.Exec(ctx, string(up)); err != nil {
		t.Fatal(err)
	}
	for name, c := range map[string]struct {
		id   uuid.UUID
		want string // "" = NULL
	}{
		"Cyrillic example": {cyrillicEx, "ru"}, "Latin, uz word": {latinUz, "uz"}, "Latin, en word": {latinEn, "en"},
		"no languages at all": {latinUnknown, ""}, "blank example": {empty, ""}, "no example": {noExample, ""},
	} {
		got := f.exampleLang(t, c.id)
		if (c.want == "" && got != nil) || (c.want != "" && !equalLang(got, c.want)) {
			t.Errorf("%s: %v, want %q", name, got, c.want)
		}
	}
}
