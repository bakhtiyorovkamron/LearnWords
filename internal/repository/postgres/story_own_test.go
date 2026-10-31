package postgres

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"

	"learnwords/internal/domain"
	"learnwords/migrations"
)

type storyFixture struct {
	moveFixture
	repo *StoryRepository
}

func newStoryFixture(t *testing.T) storyFixture {
	f := newMoveFixture(t)
	return storyFixture{f, NewStoryRepository(f.pool)}
}

func (f storyFixture) ai(t *testing.T, day, text string) domain.DailyStory {
	t.Helper()
	st, err := f.repo.Upsert(context.Background(), domain.DailyStory{
		UserID: f.user, Date: day, Genre: "Märchen", Title: "KI", StoryDE: text,
		WordsUsed: []domain.StoryWord{{Word: "Hund"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	return st
}

func (f storyFixture) own(t *testing.T, day, title, text string) domain.DailyStory {
	t.Helper()
	st, err := f.repo.CreateOwn(context.Background(), domain.DailyStory{UserID: f.user, Date: day, Title: title, StoryDE: text})
	if err != nil {
		t.Fatal(err)
	}
	return st
}

const day = "2026-10-16"

func TestStories_TwoAIUpsertsOnOneDay_OneRow(t *testing.T) {
	f := newStoryFixture(t)
	ctx := context.Background()
	first := f.ai(t, day, "Erste Fassung des Textes.")
	if first.Source != domain.StorySourceAI {
		t.Errorf("source %q", first.Source)
	}
	if err := f.repo.PutTranslation(ctx, first.ID, "ru", domain.StoryTranslation{Translation: "Первая", Source: domain.StorySourceAI}); err != nil {
		t.Fatal(err)
	}

	second := f.ai(t, day, "Zweite Fassung des Textes.")
	if second.ID != first.ID {
		t.Errorf("regeneration must keep the row (id %s → %s)", first.ID, second.ID)
	}
	if n := f.count(t, `SELECT count(*) FROM daily_stories WHERE user_id = $1`, f.user); n != 1 {
		t.Errorf("rows: %d, want 1", n)
	}
	if second.StoryDE != "Zweite Fassung des Textes." {
		t.Errorf("text: %q", second.StoryDE)
	}
	if _, ok, _ := f.repo.GetTranslation(ctx, second.ID, "ru"); ok {
		t.Error("the translation of the previous text survived the regeneration")
	}
}

func TestStories_OwnStoriesAndTheAIStoryCoexistOnOneDay(t *testing.T) {
	f := newStoryFixture(t)
	ctx := context.Background()
	ai := f.ai(t, day, "Die Geschichte des Tages.")
	o1 := f.own(t, day, "Eigene eins", "Mein erster eigener Text.")
	o2 := f.own(t, day, "Eigene zwei", "Mein zweiter eigener Text.")

	if n := f.count(t, `SELECT count(*) FROM daily_stories WHERE user_id = $1 AND date = $2::date`, f.user, day); n != 3 {
		t.Fatalf("rows on %s: %d, want 3", day, n)
	}
	// "The story of the day" is the AI one — an own story never hides it.
	got, err := f.repo.ByDate(ctx, f.user, day)
	if err != nil || got.ID != ai.ID || got.Source != domain.StorySourceAI {
		t.Fatalf("ByDate: %+v %v", got, err)
	}
	if o1.Source != domain.StorySourceUser || o1.Genre != "" || o1.ProofreadStatus != domain.ProofreadNone || len(o1.WordsUsed) != 0 {
		t.Errorf("own story: %+v", o1)
	}
	// Regenerating the AI story leaves the own ones alone.
	f.ai(t, day, "Eine neue Geschichte des Tages.")
	if _, err := f.repo.ByID(ctx, f.user, o1.ID); err != nil {
		t.Errorf("own story lost: %v", err)
	}
	if _, err := f.repo.ByID(ctx, f.user, o2.ID); err != nil {
		t.Errorf("own story lost: %v", err)
	}

	// Only own stories on a day: ByDate has nothing to return.
	other := "2026-10-15"
	f.own(t, other, "Nur eigene", "Nur ein eigener Text hier.")
	if _, err := f.repo.ByDate(ctx, f.user, other); !errors.Is(err, domain.ErrNotFound) {
		t.Errorf("ByDate with only own stories: %v", err)
	}
}

func TestStories_UsersWithWordsOn_IgnoresOwnStories(t *testing.T) {
	f := newStoryFixture(t)
	ctx := context.Background()
	// The user added a word that day (UTC), so the cron wants an AI story for them.
	f.exec(t, `INSERT INTO contexts (id, user_id, source_text) VALUES ($1, $2, 'x')`, uuid.New(), f.user)
	ctxID := uuid.New()
	f.exec(t, `INSERT INTO contexts (id, user_id, source_text) VALUES ($1, $2, 'x')`, ctxID, f.user)
	f.exec(t, `INSERT INTO word_cards (id, context_id, user_id, word, created_at) VALUES ($1, $2, $3, 'Hund', $4)`,
		uuid.New(), ctxID, f.user, time.Date(2026, 10, 16, 10, 0, 0, 0, time.UTC))

	has := func() bool {
		users, err := f.repo.UsersWithWordsOn(ctx, day)
		if err != nil {
			t.Fatal(err)
		}
		for _, u := range users {
			if u == f.user {
				return true
			}
		}
		return false
	}
	if !has() {
		t.Fatal("setup: the user should be listed")
	}
	f.own(t, day, "Eigene", "Ein eigener Text für heute.")
	if !has() {
		t.Error("an own story must not stop the daily AI story")
	}
	f.ai(t, day, "Die Geschichte des Tages.")
	if has() {
		t.Error("with the AI story saved the user is done for the day")
	}
}

func TestStories_DeleteOwn_AIStoryIsNotFound_OwnIsRemovedWithItsTranslations(t *testing.T) {
	f := newStoryFixture(t)
	ctx := context.Background()
	ai := f.ai(t, day, "Die Geschichte des Tages.")
	own := f.own(t, day, "Eigene", "Ein eigener Text für heute.")
	f.repo.PutTranslation(ctx, own.ID, "ru", domain.StoryTranslation{Translation: "Свой", Source: domain.StorySourceUser}) //nolint:errcheck

	if err := f.repo.DeleteOwn(ctx, f.user, ai.ID); !errors.Is(err, domain.ErrNotFound) {
		t.Errorf("delete of an AI story: %v", err)
	}
	if _, err := f.repo.ByID(ctx, f.user, ai.ID); err != nil {
		t.Errorf("the AI story is gone: %v", err)
	}
	other := newStoryFixture(t)
	if err := other.repo.DeleteOwn(ctx, other.user, own.ID); !errors.Is(err, domain.ErrNotFound) {
		t.Errorf("delete of somebody else's story: %v", err)
	}
	if err := f.repo.DeleteOwn(ctx, f.user, own.ID); err != nil {
		t.Fatal(err)
	}
	if n := f.count(t, `SELECT count(*) FROM story_translations WHERE story_id = $1`, own.ID); n != 0 {
		t.Errorf("translations left: %d", n)
	}
	if err := f.repo.DeleteOwn(ctx, f.user, own.ID); !errors.Is(err, domain.ErrNotFound) {
		t.Errorf("second delete: %v", err)
	}
}

func TestStories_UpdateOwn(t *testing.T) {
	f := newStoryFixture(t)
	ctx := context.Background()
	ai := f.ai(t, day, "Die Geschichte des Tages.")
	own := f.own(t, day, "Eigene", "Ein eigener Text für heute.")
	for _, lang := range []string{"ru", "en"} {
		f.repo.PutTranslation(ctx, own.ID, lang, domain.StoryTranslation{Translation: "t-" + lang, Source: domain.StorySourceAI}) //nolint:errcheck
	}

	// Title only: translations stay.
	upd, err := f.repo.UpdateOwn(ctx, f.user, own.ID, "Neuer Titel", "Ein eigener Text für heute.")
	if err != nil || upd.Title != "Neuer Titel" {
		t.Fatalf("%+v %v", upd, err)
	}
	if n := f.count(t, `SELECT count(*) FROM story_translations WHERE story_id = $1`, own.ID); n != 2 {
		t.Errorf("a title-only edit dropped translations: %d left", n)
	}
	// Text changed: every cached translation goes.
	upd, err = f.repo.UpdateOwn(ctx, f.user, own.ID, "Neuer Titel", "Ein ganz anderer Text.")
	if err != nil || upd.StoryDE != "Ein ganz anderer Text." {
		t.Fatalf("%+v %v", upd, err)
	}
	if n := f.count(t, `SELECT count(*) FROM story_translations WHERE story_id = $1`, own.ID); n != 0 {
		t.Errorf("translations of the old text left: %d", n)
	}
	// An AI story and somebody else's story cannot be edited.
	if _, err := f.repo.UpdateOwn(ctx, f.user, ai.ID, "x", "Ein Text ohne Wert."); !errors.Is(err, domain.ErrNotFound) {
		t.Errorf("update of an AI story: %v", err)
	}
	if _, err := newStoryFixture(t).repo.UpdateOwn(ctx, uuid.New(), own.ID, "x", "Ein Text ohne Wert."); !errors.Is(err, domain.ErrNotFound) {
		t.Errorf("update of somebody else's story: %v", err)
	}
	if cur, _ := f.repo.ByID(ctx, f.user, ai.ID); cur.StoryDE != "Die Geschichte des Tages." {
		t.Errorf("the AI story changed: %q", cur.StoryDE)
	}
}

func TestStories_TranslationSourceAndDelete(t *testing.T) {
	f := newStoryFixture(t)
	ctx := context.Background()
	own := f.own(t, day, "Eigene", "Ein eigener Text für heute.")

	f.repo.PutTranslation(ctx, own.ID, "ru", domain.StoryTranslation{Translation: "мой", Source: domain.StorySourceUser}) //nolint:errcheck
	got, ok, err := f.repo.GetTranslation(ctx, own.ID, "ru")
	if err != nil || !ok || got.Source != domain.StorySourceUser || got.Translation != "мой" {
		t.Fatalf("%+v %v %v", got, ok, err)
	}
	if got.WordGlosses == nil || len(got.WordGlosses) != 0 {
		t.Errorf("glosses of an own story: %#v", got.WordGlosses)
	}
	// Default source is the AI.
	f.repo.PutTranslation(ctx, own.ID, "en", domain.StoryTranslation{Translation: "mine"}) //nolint:errcheck
	if g, _, _ := f.repo.GetTranslation(ctx, own.ID, "en"); g.Source != domain.StorySourceAI {
		t.Errorf("default source %q", g.Source)
	}
	if err := f.repo.DeleteTranslation(ctx, own.ID, "ru"); err != nil {
		t.Fatal(err)
	}
	if _, ok, _ := f.repo.GetTranslation(ctx, own.ID, "ru"); ok {
		t.Error("not deleted")
	}
	if _, ok, _ := f.repo.GetTranslation(ctx, own.ID, "en"); !ok {
		t.Error("another language was deleted too")
	}
}

func TestStories_ListIsNewestFirstWithoutText_AndStatsCountOnlyAI(t *testing.T) {
	f := newStoryFixture(t)
	ctx := context.Background()
	old := f.own(t, "2026-10-14", "Alt", "Ein alter eigener Text.")
	ai := f.ai(t, "2026-10-16", "Die Geschichte des Tages.")
	time.Sleep(5 * time.Millisecond)
	newer := f.own(t, "2026-10-16", "Neu", "Ein neuer eigener Text.")

	list, err := f.repo.List(ctx, f.user, 500)
	if err != nil || len(list) != 3 {
		t.Fatalf("%v %v", list, err)
	}
	if list[0].ID != newer.ID || list[1].ID != ai.ID || list[2].ID != old.ID {
		t.Errorf("order: %s %s %s", list[0].Title, list[1].Title, list[2].Title)
	}
	for _, s := range list {
		if s.StoryDE != "" {
			t.Errorf("%q: the list must not carry the text", s.Title)
		}
		if s.Source == "" || s.Title == "" {
			t.Errorf("list item lacks metadata: %+v", s)
		}
	}
	// By id the text is there.
	if got, _ := f.repo.ByID(ctx, f.user, newer.ID); got.StoryDE != "Ein neuer eigener Text." {
		t.Errorf("by id: %q", got.StoryDE)
	}

	st, err := NewAdminRepository(f.pool).Stats(ctx)
	if err != nil {
		t.Fatal(err)
	}
	var ai1 int
	f.pool.QueryRow(ctx, `SELECT count(*) FROM daily_stories WHERE source = 'ai'`).Scan(&ai1) //nolint:errcheck
	if st.TotalStories != ai1 {
		t.Errorf("TotalStories %d counts own stories (AI: %d)", st.TotalStories, ai1)
	}
}

func TestStories_TranslationLang_SetAtCreationAndFixedOnce(t *testing.T) {
	f := newStoryFixture(t)
	ctx := context.Background()

	// A generated story carries the language from the request; a cron story has none.
	withLang, err := f.repo.Upsert(ctx, domain.DailyStory{UserID: f.user, Date: day, StoryDE: "Text.", TranslationLang: "uz"})
	if err != nil || withLang.TranslationLang != "uz" {
		t.Fatalf("upsert: %+v %v", withLang, err)
	}
	cron, err := f.repo.Upsert(ctx, domain.DailyStory{UserID: f.user, Date: "2026-10-17", StoryDE: "Text zwei."})
	if err != nil || cron.TranslationLang != "" {
		t.Fatalf("cron story: %+v %v", cron, err)
	}
	// Own stories get it at creation too.
	mine, err := f.repo.CreateOwn(ctx, domain.DailyStory{UserID: f.user, Date: day, Title: "Mein", StoryDE: "Mein Text.", TranslationLang: "en"})
	if err != nil || mine.TranslationLang != "en" {
		t.Fatalf("own: %+v %v", mine, err)
	}

	// The first caller fixes the language; the second one gets the winner's.
	first, err := f.repo.FixTranslationLang(ctx, cron.ID, "uz")
	if err != nil || first != "uz" {
		t.Fatalf("first fix: %q %v", first, err)
	}
	second, err := f.repo.FixTranslationLang(ctx, cron.ID, "ru")
	if err != nil || second != "uz" {
		t.Fatalf("second fix must return the winner uz: %q %v", second, err)
	}
	got, _ := f.repo.ByID(ctx, f.user, cron.ID)
	if got.TranslationLang != "uz" {
		t.Errorf("stored: %q", got.TranslationLang)
	}
	// Editing an own story keeps the language.
	upd, err := f.repo.UpdateOwn(ctx, f.user, mine.ID, "Neu", "Neuer Text.")
	if err != nil || upd.TranslationLang != "en" {
		t.Errorf("update: %+v %v", upd, err)
	}
	if _, err := f.repo.FixTranslationLang(ctx, uuid.New(), "ru"); !errors.Is(err, domain.ErrNotFound) {
		t.Errorf("unknown story: %v", err)
	}
}

// The migration's backfill takes the language of the EARLIEST translation row (a tie → ru); a story
// without translation rows stays NULL.
func TestMigration39_BackfillPicksTheEarliestTranslation(t *testing.T) {
	f := newStoryFixture(t)
	ctx := context.Background()
	mk := func(d string) uuid.UUID { return f.ai(t, d, "Text für "+d).ID }
	early, tie, none := mk("2026-09-01"), mk("2026-09-02"), mk("2026-09-03")
	put := func(id uuid.UUID, lang, at string) {
		f.exec(t, `INSERT INTO story_translations (story_id, lang, translation_text, created_at) VALUES ($1, $2, 'x', $3::timestamptz)`, id, lang, at)
	}
	put(early, "ru", "2026-09-05T10:00:00Z")
	put(early, "uz", "2026-09-04T10:00:00Z") // earlier than ru
	put(early, "en", "2026-09-06T10:00:00Z")
	put(tie, "uz", "2026-09-05T10:00:00Z")
	put(tie, "ru", "2026-09-05T10:00:00Z") // same time → ru
	f.exec(t, `UPDATE daily_stories SET translation_lang = NULL WHERE id = ANY($1)`, []uuid.UUID{early, tie, none})

	sqlBytes, err := migrations.FS.ReadFile("000039_story_translation_lang.up.sql")
	if err != nil {
		t.Fatal(err)
	}
	f.exec(t, string(sqlBytes)) // idempotent: ADD COLUMN IF NOT EXISTS, then the backfill

	lang := func(id uuid.UUID) string {
		s, err := f.repo.ByID(ctx, f.user, id)
		if err != nil {
			t.Fatal(err)
		}
		return s.TranslationLang
	}
	if got := lang(early); got != "uz" {
		t.Errorf("earliest row: %q, want uz", got)
	}
	if got := lang(tie); got != "ru" {
		t.Errorf("tie: %q, want ru", got)
	}
	if got := lang(none); got != "" {
		t.Errorf("no rows: %q, want NULL", got)
	}
}
