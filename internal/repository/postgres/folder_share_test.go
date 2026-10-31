package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"regexp"
	"strings"
	"testing"

	"github.com/google/uuid"

	"learnwords/internal/domain"
)

type shareFixture struct {
	moveFixture
	repo *FolderRepository
}

func newShareFixture(t *testing.T) shareFixture {
	f := newMoveFixture(t)
	return shareFixture{moveFixture: f, repo: NewFolderRepository(f.pool)}
}

// sourceWord adds a card to the owner's folder with grammar, audio, example and an English translation.
func (f moveFixture) sourceWord(t *testing.T, owner, folder uuid.UUID, word, translation string) uuid.UUID {
	ctxID, id := uuid.New(), uuid.New()
	f.exec(t, `INSERT INTO contexts (id, user_id, source_text) VALUES ($1, $2, $3)`, ctxID, owner, word)
	f.exec(t, `INSERT INTO word_cards (id, context_id, user_id, word, translation, transcription, audio_url,
		example_sentence, example_translation, folder_id, lemma, article, plural, part_of_speech)
		VALUES ($1, $2, $3, $4, $5, '[tr]', 'https://audio/x.mp3', 'Ich sehe ___.', 'Я вижу.', $6, $4, 'der', 'Xe', 'noun')`,
		id, ctxID, owner, word, translation, folder)
	f.exec(t, `INSERT INTO word_translations (word_id, language, translation, example_translation)
		VALUES ($1, 'ru', $2, 'Я вижу.'), ($1, 'en', $3, 'I see.')`, id, translation, "en-"+translation)
	f.exec(t, `INSERT INTO word_progress (word_id, user_id, box_level, is_learned) VALUES ($1, $2, 5, true)`, id, owner)
	return id
}

func (f moveFixture) count(t *testing.T, sql string, args ...any) int {
	var n int
	if err := f.pool.QueryRow(context.Background(), sql, args...).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func (f moveFixture) addUserWord(t *testing.T, user uuid.UUID, word string) {
	ctxID := uuid.New()
	f.exec(t, `INSERT INTO contexts (id, user_id, source_text) VALUES ($1, $2, $3)`, ctxID, user, word)
	f.exec(t, `INSERT INTO word_cards (id, context_id, user_id, word, translation) VALUES ($1, $2, $3, $4, 'x')`, uuid.New(), ctxID, user, word)
}

func TestShareToken(t *testing.T) {
	re := regexp.MustCompile(`^[0-9A-Za-z]{10}$`)
	seen := map[string]bool{}
	for i := 0; i < 500; i++ {
		tok, err := NewShareToken()
		if err != nil || !re.MatchString(tok) {
			t.Fatalf("token %q: %v", tok, err)
		}
		if seen[tok] {
			t.Fatalf("duplicate token %q in 500", tok)
		}
		seen[tok] = true
	}
}

func TestShare_EnableRegenerateDisable_OwnerOnly(t *testing.T) {
	f := newShareFixture(t)
	other := newShareFixture(t)
	ctx := context.Background()
	folder := f.folder(t, f.user)

	tok, err := f.repo.EnableShare(ctx, f.user, folder)
	if err != nil || tok == "" {
		t.Fatal(tok, err)
	}
	if again, _ := f.repo.EnableShare(ctx, f.user, folder); again != tok {
		t.Errorf("enable twice must return the same link: %q vs %q", again, tok)
	}
	if _, err := f.repo.GetShared(ctx, tok, ""); err != nil {
		t.Fatal(err)
	}

	// Somebody else's folder: 404 for every owner action, and nothing changes.
	if _, err := other.repo.EnableShare(ctx, other.user, folder); !errors.Is(err, domain.ErrNotFound) {
		t.Errorf("enable by non-owner: %v", err)
	}
	if _, err := other.repo.RegenerateShare(ctx, other.user, folder); !errors.Is(err, domain.ErrNotFound) {
		t.Errorf("regenerate by non-owner: %v", err)
	}
	if err := other.repo.DisableShare(ctx, other.user, folder); !errors.Is(err, domain.ErrNotFound) {
		t.Errorf("disable by non-owner: %v", err)
	}
	if _, err := f.repo.GetShared(ctx, tok, ""); err != nil {
		t.Errorf("a non-owner's attempts changed the link: %v", err)
	}
	notShared := other.folder(t, other.user)
	if _, err := f.repo.EnableShare(ctx, f.user, notShared); !errors.Is(err, domain.ErrNotFound) {
		t.Errorf("enable on another user's folder: %v", err)
	}

	// Regenerate: the old link dies, the new one works.
	fresh, err := f.repo.RegenerateShare(ctx, f.user, folder)
	if err != nil || fresh == tok {
		t.Fatalf("regenerate: %q %v", fresh, err)
	}
	if _, err := f.repo.GetShared(ctx, tok, ""); !errors.Is(err, domain.ErrNotFound) {
		t.Errorf("old link still works: %v", err)
	}
	if _, err := f.repo.GetShared(ctx, fresh, ""); err != nil {
		t.Errorf("new link: %v", err)
	}

	// Disable: not shared any more.
	if err := f.repo.DisableShare(ctx, f.user, folder); err != nil {
		t.Fatal(err)
	}
	if _, err := f.repo.GetShared(ctx, fresh, ""); !errors.Is(err, domain.ErrNotFound) {
		t.Errorf("disabled link still works: %v", err)
	}
	list, _ := f.repo.List(ctx, f.user)
	if list.Folders[0].ShareToken != nil {
		t.Error("list still shows a token")
	}
}

func TestGetShared_PublicViewLeaksNothingAndPrefersLanguage(t *testing.T) {
	f := newShareFixture(t)
	ctx := context.Background()
	folder := f.folder(t, f.user)
	f.exec(t, `UPDATE folders SET name = 'Tiere' WHERE id = $1`, folder) // the fixture names folders by their id
	wid := f.sourceWord(t, f.user, folder, "Hund", "собака")
	tok, _ := f.repo.EnableShare(ctx, f.user, folder)

	sf, err := f.repo.GetShared(ctx, tok, "en")
	if err != nil {
		t.Fatal(err)
	}
	if sf.WordCount != 1 || len(sf.Words) != 1 || sf.Words[0].Translation != "en-собака" || sf.Words[0].ExampleTranslation != "I see." {
		t.Errorf("en: %+v", sf)
	}
	if sf2, _ := f.repo.GetShared(ctx, tok, ""); sf2.Words[0].Translation != "собака" {
		t.Errorf("no lang → the card's own translation: %+v", sf2.Words[0])
	}
	if sf3, _ := f.repo.GetShared(ctx, tok, "uz"); sf3.Words[0].Translation != "собака" {
		t.Errorf("no uz row → fall back to the card's translation: %+v", sf3.Words[0])
	}

	raw, _ := json.Marshal(sf)
	body := string(raw)
	for _, secret := range []string{f.user.String(), wid.String(), folder.String(), f.user.String() + "@test", "user_id", "email", "box_level", "is_learned", "next_review", "\"id\""} {
		if strings.Contains(body, secret) {
			t.Errorf("public view leaks %q: %s", secret, body)
		}
	}
	if sf.Language != "de" || sf.Name == "" {
		t.Errorf("header: %+v", sf)
	}
	// An empty folder is still a valid, shared folder with "words": [].
	empty := f.folder(t, f.user)
	etok, _ := f.repo.EnableShare(ctx, f.user, empty)
	if ef, err := f.repo.GetShared(ctx, etok, ""); err != nil || ef.Words == nil || len(ef.Words) != 0 {
		t.Errorf("empty folder: %+v %v", ef, err)
	}
}

func TestImportShared_CopiesWordsAndTranslations_SkipsExisting_NoProgress(t *testing.T) {
	owner := newShareFixture(t)
	me := newShareFixture(t)
	ctx := context.Background()

	src := owner.folder(t, owner.user)
	owner.exec(t, `UPDATE folders SET name = 'Tiere', color = 'amber' WHERE id = $1`, src)
	owner.sourceWord(t, owner.user, src, "der Hund", "собака") // I have "Hund"  → skipped
	owner.sourceWord(t, owner.user, src, "Haus", "дом")        // I have "das Haus" → skipped
	owner.sourceWord(t, owner.user, src, "Katze", "кошка")
	owner.sourceWord(t, owner.user, src, "Baum", "дерево")
	tok, _ := owner.repo.EnableShare(ctx, owner.user, src)

	me.addUserWord(t, me.user, "Hund")
	me.addUserWord(t, me.user, "das Haus")

	res, err := me.repo.ImportShared(ctx, me.user, "de", tok, 100)
	if err != nil {
		t.Fatal(err)
	}
	if res.Added != 2 || res.Skipped != 2 {
		t.Fatalf("added %d skipped %d, want 2/2", res.Added, res.Skipped)
	}

	var name, color string
	var from *uuid.UUID
	if err := me.pool.QueryRow(ctx, `SELECT name, color, imported_from FROM folders WHERE id = $1 AND user_id = $2`,
		res.FolderID, me.user).Scan(&name, &color, &from); err != nil {
		t.Fatal(err)
	}
	if name != "Tiere" || color != "amber" || from == nil || *from != src {
		t.Errorf("folder: %q %q from %v", name, color, from)
	}

	// The copies: own ids and context, grammar, audio, example, translations — in the new folder.
	var cardID uuid.UUID
	var word, translation, transcription, audio, example, lemma, article, pos string
	if err := me.pool.QueryRow(ctx, `
		SELECT id, word, translation, transcription, audio_url, example_sentence, lemma, article, part_of_speech
		FROM word_cards WHERE folder_id = $1 AND word = 'Katze' AND user_id = $2`, res.FolderID, me.user).
		Scan(&cardID, &word, &translation, &transcription, &audio, &example, &lemma, &article, &pos); err != nil {
		t.Fatal(err)
	}
	if translation != "кошка" || transcription != "[tr]" || audio != "https://audio/x.mp3" || example != "Ich sehe ___." ||
		lemma != "Katze" || article != "der" || pos != "noun" {
		t.Errorf("copied fields: %q %q %q %q %q %q %q", translation, transcription, audio, example, lemma, article, pos)
	}
	if n := me.count(t, `SELECT count(*) FROM word_translations WHERE word_id = $1`, cardID); n != 2 {
		t.Errorf("translations copied: %d, want 2 (ru + en)", n)
	}
	if n := me.count(t, `SELECT count(*) FROM contexts c JOIN word_cards w ON w.context_id = c.id
		WHERE w.id = $1 AND c.user_id = $2 AND c.source_text = 'Katze' AND c.meaning = 'кошка'`, cardID, me.user); n != 1 {
		t.Errorf("context of the copy: %d", n)
	}

	// Fresh words: no progress copied, not learned, box 1 by default.
	if n := me.count(t, `SELECT count(*) FROM word_progress WHERE user_id = $1`, me.user); n != 0 {
		t.Errorf("progress rows for the importer: %d, want 0", n)
	}
	if n := me.count(t, `SELECT count(*) FROM word_cards WHERE folder_id = $1`, res.FolderID); n != 2 {
		t.Errorf("cards in the new folder: %d", n)
	}
	// The source is untouched and counted once.
	if n := owner.count(t, `SELECT count(*) FROM word_cards WHERE folder_id = $1`, src); n != 4 {
		t.Errorf("source folder changed: %d words", n)
	}
	if n := owner.count(t, `SELECT count(*) FROM word_progress WHERE user_id = $1 AND is_learned`, owner.user); n != 4 {
		t.Errorf("owner's progress changed: %d", n)
	}
	list, _ := owner.repo.List(ctx, owner.user)
	if list.Folders[0].ImportCount != 1 {
		t.Errorf("import_count %d, want 1", list.Folders[0].ImportCount)
	}
}

func TestImportShared_NameCollisionAndRepeat(t *testing.T) {
	owner := newShareFixture(t)
	me := newShareFixture(t)
	ctx := context.Background()
	src := owner.folder(t, owner.user)
	owner.exec(t, `UPDATE folders SET name = 'Tiere' WHERE id = $1`, src)
	owner.sourceWord(t, owner.user, src, "Katze", "кошка")
	tok, _ := owner.repo.EnableShare(ctx, owner.user, src)
	me.exec(t, `INSERT INTO folders (id, user_id, name) VALUES ($1, $2, 'TIERE')`, uuid.New(), me.user) // case-insensitive clash

	nameOf := func(id uuid.UUID) string {
		var n string
		me.pool.QueryRow(ctx, `SELECT name FROM folders WHERE id = $1`, id).Scan(&n) //nolint:errcheck
		return n
	}
	first, err := me.repo.ImportShared(ctx, me.user, "de", tok, 100)
	if err != nil || nameOf(first.FolderID) != "Tiere (2)" {
		t.Fatalf("first: %v %q", err, nameOf(first.FolderID))
	}
	second, err := me.repo.ImportShared(ctx, me.user, "de", tok, 100)
	if err != nil || nameOf(second.FolderID) != "Tiere (3)" {
		t.Fatalf("second: %v %q", err, nameOf(second.FolderID))
	}
	if second.Added != 0 || second.Skipped != 1 {
		t.Errorf("repeat import: added %d skipped %d", second.Added, second.Skipped)
	}
	if n := owner.count(t, `SELECT count(*) FROM folder_imports WHERE folder_id = $1`, src); n != 1 {
		t.Errorf("one user counts once: %d", n)
	}
	// A 40-character name still fits with the suffix.
	long := strings.Repeat("я", 40)
	if got := uniqueFolderName(long, []string{long}); len([]rune(got)) > 40 || !strings.HasSuffix(got, " (2)") {
		t.Errorf("long name: %q", got)
	}
}

func TestImportShared_Refusals(t *testing.T) {
	owner := newShareFixture(t)
	me := newShareFixture(t)
	ctx := context.Background()
	src := owner.folder(t, owner.user)
	owner.sourceWord(t, owner.user, src, "Katze", "кошка")
	tok, _ := owner.repo.EnableShare(ctx, owner.user, src)

	_, err := owner.repo.ImportShared(ctx, owner.user, "de", tok, 100)
	if id, ok := domain.IsOwnFolder(err); !errors.Is(err, domain.ErrOwnFolder) || !ok || id != src {
		t.Errorf("own folder: %v", err)
	}
	if _, err := me.repo.ImportShared(ctx, me.user, "en", tok, 100); !errors.Is(err, domain.ErrLangMismatch) {
		t.Errorf("language mismatch: %v", err)
	}
	if _, err := me.repo.ImportShared(ctx, me.user, "de", "Zzzzzzzzzz", 100); !errors.Is(err, domain.ErrNotFound) {
		t.Errorf("unknown token: %v", err)
	}
	me.folder(t, me.user)
	if _, err := me.repo.ImportShared(ctx, me.user, "de", tok, 1); !errors.Is(err, domain.ErrValidation) {
		t.Errorf("folder limit: %v", err)
	}
	owner.repo.DisableShare(ctx, owner.user, src) //nolint:errcheck
	if _, err := me.repo.ImportShared(ctx, me.user, "de", tok, 100); !errors.Is(err, domain.ErrNotFound) {
		t.Errorf("disabled link: %v", err)
	}
	// Every refusal left the importer with nothing new.
	if n := me.count(t, `SELECT count(*) FROM word_cards WHERE user_id = $1`, me.user); n != 0 {
		t.Errorf("cards after refusals: %d", n)
	}
	if n := me.count(t, `SELECT count(*) FROM folders WHERE user_id = $1`, me.user); n != 1 {
		t.Errorf("folders after refusals: %d, want only the pre-existing one", n)
	}
}

// If anything fails half-way, the new folder and the words copied so far disappear with it.
func TestImportShared_RollsBackOnError(t *testing.T) {
	owner := newShareFixture(t)
	me := newShareFixture(t)
	ctx := context.Background()
	src := owner.folder(t, owner.user)
	owner.sourceWord(t, owner.user, src, "Katze", "кошка")
	owner.sourceWord(t, owner.user, src, "Boom", "бабах") // the trigger below rejects this one
	owner.sourceWord(t, owner.user, src, "Baum", "дерево")
	tok, _ := owner.repo.EnableShare(ctx, owner.user, src)

	owner.exec(t, `CREATE OR REPLACE FUNCTION lw_test_reject_boom() RETURNS trigger AS $$
		BEGIN IF NEW.word = 'Boom' AND NEW.user_id = '`+me.user.String()+`' THEN RAISE EXCEPTION 'boom'; END IF; RETURN NEW; END $$ LANGUAGE plpgsql`)
	owner.exec(t, `CREATE TRIGGER lw_test_boom BEFORE INSERT ON word_cards FOR EACH ROW EXECUTE FUNCTION lw_test_reject_boom()`)
	t.Cleanup(func() {
		owner.pool.Exec(ctx, `DROP TRIGGER IF EXISTS lw_test_boom ON word_cards`) //nolint:errcheck
		owner.pool.Exec(ctx, `DROP FUNCTION IF EXISTS lw_test_reject_boom()`)     //nolint:errcheck
	})

	if _, err := me.repo.ImportShared(ctx, me.user, "de", tok, 100); err == nil {
		t.Fatal("expected the import to fail")
	}
	for _, q := range []string{
		`SELECT count(*) FROM folders WHERE user_id = $1`,
		`SELECT count(*) FROM word_cards WHERE user_id = $1`,
		`SELECT count(*) FROM contexts WHERE user_id = $1`,
		`SELECT count(*) FROM folder_imports WHERE user_id = $1`,
	} {
		if n := me.count(t, q, me.user); n != 0 {
			t.Errorf("%s → %d after a failed import, want 0", q, n)
		}
	}
}

// A source card without a translation (old data) is not copied: it would be an empty question.
func TestImportShared_SkipsCardsWithoutATranslation(t *testing.T) {
	owner := newShareFixture(t)
	me := newShareFixture(t)
	ctx := context.Background()
	src := owner.folder(t, owner.user)
	owner.sourceWord(t, owner.user, src, "Katze", "кошка")
	owner.sourceWord(t, owner.user, src, "Baum", "")
	owner.sourceWord(t, owner.user, src, "Haus", "   ")
	tok, _ := owner.repo.EnableShare(ctx, owner.user, src)

	res, err := me.repo.ImportShared(ctx, me.user, "de", tok, 100)
	if err != nil {
		t.Fatal(err)
	}
	if res.Added != 1 || res.Skipped != 2 {
		t.Fatalf("added %d skipped %d, want 1/2", res.Added, res.Skipped)
	}
	if n := me.count(t, `SELECT count(*) FROM word_cards WHERE user_id = $1 AND btrim(translation) = ''`, me.user); n != 0 {
		t.Errorf("%d cards without a translation were copied", n)
	}
}
