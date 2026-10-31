package service

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"learnwords/internal/domain"
)

const goodText = "Der Hund läuft durch den Park.\nDie Sonne scheint."

func ownService(translator StoryTranslator) (*StoryService, *fakeStoryRepo) {
	repo := newFakeStoryRepo()
	return &StoryService{repo: repo, translator: translator, now: time.Now}, repo
}

func manual(text, translation string) domain.OwnStoryInput {
	return domain.OwnStoryInput{Text: text, TranslationMode: domain.TranslationManual, Translation: translation}
}
func auto(text string) domain.OwnStoryInput {
	return domain.OwnStoryInput{Text: text, TranslationMode: domain.TranslationAuto}
}

func TestCreateOwn_Manual_TranslationIsTheUsers_AINeverCalled(t *testing.T) {
	tr := newFakeTranslator()
	s, repo := ownService(tr)
	uid := uuid.New()

	st, err := s.CreateOwnStory(context.Background(), uid, manual(goodText, "Собака бежит по парку."), "ru")
	if err != nil {
		t.Fatal(err)
	}
	if st.Source != domain.StorySourceUser || st.StoryTranslation != "Собака бежит по парку." ||
		st.TranslationSource != domain.StorySourceUser || st.Language != "ru" {
		t.Errorf("story: %+v", st)
	}
	if got := repo.cache[repo.key(st.ID, "ru")]; got.Source != domain.StorySourceUser || got.Translation != "Собака бежит по парку." {
		t.Errorf("cached: %+v", got)
	}
	if len(tr.calls) != 0 {
		t.Errorf("the translator was called: %v", tr.calls)
	}
	if st.Date != s.today() || st.Genre != "" || len(st.WordsUsed) != 0 {
		t.Errorf("an own story has the day, no genre and no words: %+v", st)
	}
}

func TestCreateOwn_Auto_TranslatedOnce_ThenByIDUsesTheCache(t *testing.T) {
	tr := newFakeTranslator()
	s, _ := ownService(tr)
	uid := uuid.New()

	st, err := s.CreateOwnStory(context.Background(), uid, auto(goodText), "uz")
	if err != nil {
		t.Fatal(err)
	}
	if st.TranslationSource != domain.StorySourceAI || st.StoryTranslation != "uz:"+goodText {
		t.Errorf("story: %+v", st)
	}
	again, err := s.ByID(context.Background(), uid, st.ID, "uz")
	if err != nil || again.StoryTranslation != st.StoryTranslation || again.TranslationSource != domain.StorySourceAI {
		t.Fatalf("by id: %+v %v", again, err)
	}
	if n := tr.calls[goodText+":uz"]; n != 1 {
		t.Errorf("translator called %d times, want 1", n)
	}
	// The story's language is fixed: another interface language gets the same translation, no AI call.
	if other, _ := s.ByID(context.Background(), uid, st.ID, "en"); other.StoryTranslation != "uz:"+goodText || other.TranslationLang != "uz" {
		t.Errorf("en: %+v", other)
	}
	if n := tr.calls[goodText+":en"]; n != 0 {
		t.Errorf("en translator calls: %d, want 0", n)
	}
}

func TestCreateOwn_Auto_WithoutTranslator_IsUnavailableAndNothingIsSaved(t *testing.T) {
	s, repo := ownService(nil)
	if _, err := s.CreateOwnStory(context.Background(), uuid.New(), auto(goodText), "ru"); !errors.Is(err, domain.ErrUnavailable) {
		t.Fatalf("got %v, want ErrUnavailable", err)
	}
	if len(repo.own) != 0 || len(repo.cache) != 0 {
		t.Errorf("something was saved: %d stories, %d translations", len(repo.own), len(repo.cache))
	}
	// A manual story needs no AI at all.
	if _, err := s.CreateOwnStory(context.Background(), uuid.New(), manual(goodText, "перевод"), "ru"); err != nil {
		t.Errorf("manual without a translator: %v", err)
	}
}

func TestCreateOwn_AIFailure_KeepsTheStoryWithoutTranslation(t *testing.T) {
	s, repo := ownService(failingTranslator{})
	st, err := s.CreateOwnStory(context.Background(), uuid.New(), auto(goodText), "ru")
	if err != nil {
		t.Fatal(err)
	}
	if st.StoryTranslation != "" || st.TranslationSource != "" || len(repo.own) != 1 {
		t.Errorf("story: %+v (saved %d)", st, len(repo.own))
	}
}

type failingTranslator struct{}

func (failingTranslator) TranslateStory(context.Context, string, string, string, []string) (string, map[string]string, error) {
	return "", nil, errors.New("boom")
}

func TestValidateOwn(t *testing.T) {
	long := strings.Repeat("Hund ", 801) // 4005 characters
	cases := []struct {
		name string
		in   domain.OwnStoryInput
		ok   bool
	}{
		{"ok", manual(goodText, "перевод"), true},
		{"empty text", auto(""), false},
		{"whitespace only", auto("   \n  "), false},
		{"9 characters", auto("Hallo Welt"[:9]), false},
		{"10 characters", auto("Hallo Welt"), true},
		{"4000 characters", auto(strings.Repeat("a", 4000)), true},
		{"4001 characters", auto(strings.Repeat("a", 4001)), false},
		{"far too long", auto(long), false},
		{"Cyrillic text", auto("Это русский текст, а не немецкий."), false},
		{"mostly Cyrillic", auto("Привет мир hallo wie geht es"), false},
		{"a little Cyrillic is fine", auto("Das Wort «собака» heißt Hund auf Deutsch."), true},
		{"manual without a translation", manual(goodText, "   "), false},
		{"manual translation too long", manual(goodText, strings.Repeat("я", 8001)), false},
		{"manual translation 8000", manual(goodText, strings.Repeat("я", 8000)), true},
		{"unknown mode", domain.OwnStoryInput{Text: goodText, TranslationMode: "magic"}, false},
		{"no mode", domain.OwnStoryInput{Text: goodText}, false},
		{"title 120", domain.OwnStoryInput{Title: strings.Repeat("t", 120), Text: goodText, TranslationMode: "auto"}, true},
		{"title 121", domain.OwnStoryInput{Title: strings.Repeat("t", 121), Text: goodText, TranslationMode: "auto"}, false},
	}
	for _, c := range cases {
		_, err := validateOwn(c.in)
		if c.ok && err != nil {
			t.Errorf("%s: unexpected %v", c.name, err)
		}
		if !c.ok {
			if err == nil || !errors.Is(err, domain.ErrValidation) {
				t.Errorf("%s: got %v, want ErrValidation", c.name, err)
			}
		}
	}
	// Through the service: a bad story is refused and nothing is saved.
	s, repo := ownService(newFakeTranslator())
	for _, in := range []domain.OwnStoryInput{auto(""), auto(strings.Repeat("a", 4001)), auto("Это русский текст, а не немецкий."), manual(goodText, ""), {Text: goodText, TranslationMode: "x"}} {
		if _, err := s.CreateOwnStory(context.Background(), uuid.New(), in, "ru"); !errors.Is(err, domain.ErrValidation) {
			t.Errorf("%+v: %v", in, err)
		}
	}
	if len(repo.own) != 0 {
		t.Error("an invalid story was saved")
	}
}

func TestValidateOwn_NormalizesNewlinesAndTrims(t *testing.T) {
	got, err := validateOwn(domain.OwnStoryInput{
		Title: "  Titel  ", Text: "  Zeile eins\r\nZeile zwei\rZeile drei  ", TranslationMode: "manual", Translation: " a\r\nb ",
	})
	if err != nil {
		t.Fatal(err)
	}
	if got.Title != "Titel" || got.Text != "Zeile eins\nZeile zwei\nZeile drei" || got.Translation != "a\nb" {
		t.Errorf("got %+v", got)
	}
}

func TestOwnTitle_TakenFromTheFirstLine(t *testing.T) {
	cases := map[string]string{
		"Der Hund läuft durch den Park.\nZweite Zeile.": "Der Hund läuft durch den Park.",
		"\n\n  Erste echte Zeile\nDie nächste":          "Erste echte Zeile",
		"Der **Hund** läuft durch den **Park**.":        "Der Hund läuft durch den Park.",
		strings.Repeat("Wort ", 20) + "Ende":            strings.TrimSpace(strings.Repeat("Wort ", 12)) + "…", // 59 runes, cut at a space
		strings.Repeat("a", 70):                         strings.Repeat("a", 60) + "…",                        // one long word: hard cut
		strings.Repeat("b", 60):                         strings.Repeat("b", 60),                              // exactly 60: not cut, no ellipsis
	}
	for text, want := range cases {
		got, err := validateOwn(auto(text))
		if err != nil {
			t.Fatalf("%q: %v", text, err)
		}
		if got.Title != want {
			t.Errorf("title of %q = %q, want %q", text, got.Title, want)
		}
		if n := len([]rune(strings.TrimSuffix(got.Title, "…"))); n > 60 {
			t.Errorf("title is %d runes", n)
		}
	}
	// An explicit title wins.
	if got, _ := validateOwn(domain.OwnStoryInput{Title: "Mein Titel", Text: goodText, TranslationMode: "auto"}); got.Title != "Mein Titel" {
		t.Errorf("explicit title: %q", got.Title)
	}
}

func TestUpdateOwn_TextChange_DropsCachedTranslations(t *testing.T) {
	tr := newFakeTranslator()
	s, repo := ownService(tr)
	uid := uuid.New()
	st, _ := s.CreateOwnStory(context.Background(), uid, auto(goodText), "ru")
	repo.cache[repo.key(st.ID, "en")] = domain.StoryTranslation{Translation: "old en"} // a row of another language left from before
	if len(repo.cache) != 2 {
		t.Fatalf("setup: %d cached", len(repo.cache))
	}

	newText := "Die Katze schläft auf dem Sofa."
	upd, err := s.UpdateOwnStory(context.Background(), uid, st.ID, auto(newText), "ru")
	if err != nil {
		t.Fatal(err)
	}
	if upd.StoryDE != newText || upd.StoryTranslation != "ru:"+newText {
		t.Errorf("updated: %+v", upd)
	}
	if _, ok := repo.cache[repo.key(st.ID, "en")]; ok {
		t.Error("the en translation of the old text survived")
	}
	if tr.calls[newText+":ru"] != 1 {
		t.Errorf("new text translated %d times", tr.calls[newText+":ru"])
	}
}

func TestUpdateOwn_TitleOnly_WithAITranslation_NoAICall(t *testing.T) {
	tr := newFakeTranslator()
	s, _ := ownService(tr)
	uid := uuid.New()
	st, _ := s.CreateOwnStory(context.Background(), uid, auto(goodText), "ru")
	before := tr.calls[goodText+":ru"]

	in := auto(goodText)
	in.Title = "Neuer Titel"
	upd, err := s.UpdateOwnStory(context.Background(), uid, st.ID, in, "ru")
	if err != nil {
		t.Fatal(err)
	}
	if upd.Title != "Neuer Titel" || upd.StoryTranslation == "" || upd.TranslationSource != domain.StorySourceAI {
		t.Errorf("updated: %+v", upd)
	}
	if tr.calls[goodText+":ru"] != before {
		t.Error("a title-only edit called the AI again")
	}
	// ... and works without a translator at all, since nothing new is needed.
	s.translator = nil
	if _, err := s.UpdateOwnStory(context.Background(), uid, st.ID, in, "ru"); err != nil {
		t.Errorf("title-only edit without a translator: %v", err)
	}
}

func TestUpdateOwn_AutoAfterManual_ReplacesTheUsersTranslation(t *testing.T) {
	tr := newFakeTranslator()
	s, repo := ownService(tr)
	uid := uuid.New()
	st, _ := s.CreateOwnStory(context.Background(), uid, manual(goodText, "мой перевод"), "ru")

	upd, err := s.UpdateOwnStory(context.Background(), uid, st.ID, auto(goodText), "ru")
	if err != nil {
		t.Fatal(err)
	}
	if upd.StoryTranslation != "ru:"+goodText || upd.TranslationSource != domain.StorySourceAI {
		t.Errorf("the user's translation was not replaced: %+v", upd)
	}
	if got := repo.cache[repo.key(st.ID, "ru")]; got.Source != domain.StorySourceAI {
		t.Errorf("cache: %+v", got)
	}
	// And back: manual overwrites the AI one.
	upd, err = s.UpdateOwnStory(context.Background(), uid, st.ID, manual(goodText, "снова мой"), "ru")
	if err != nil || upd.StoryTranslation != "снова мой" || upd.TranslationSource != domain.StorySourceUser {
		t.Errorf("manual again: %+v %v", upd, err)
	}
}

func TestUpdateOwn_NeedsAIButNoTranslator_IsRefusedBeforeChangingAnything(t *testing.T) {
	s, repo := ownService(newFakeTranslator())
	uid := uuid.New()
	st, _ := s.CreateOwnStory(context.Background(), uid, manual(goodText, "мой перевод"), "ru")
	s.translator = nil

	// The text changes → a new AI translation would be needed.
	if _, err := s.UpdateOwnStory(context.Background(), uid, st.ID, auto("Ein ganz neuer Text hier."), "ru"); !errors.Is(err, domain.ErrUnavailable) {
		t.Fatalf("got %v, want ErrUnavailable", err)
	}
	// Same text, but the cached translation is the user's, not the AI's → AI would be needed as well.
	if _, err := s.UpdateOwnStory(context.Background(), uid, st.ID, auto(goodText), "ru"); !errors.Is(err, domain.ErrUnavailable) {
		t.Fatalf("got %v, want ErrUnavailable", err)
	}
	if cur := repo.own[st.ID]; cur.StoryDE != goodText {
		t.Errorf("the story changed: %q", cur.StoryDE)
	}
	if got := repo.cache[repo.key(st.ID, "ru")]; got.Source != domain.StorySourceUser || got.Translation != "мой перевод" {
		t.Errorf("the user's translation was lost: %+v", got)
	}
}

func TestOwnStories_AIStoriesAreUntouchable(t *testing.T) {
	s, repo := ownService(newFakeTranslator())
	uid := uuid.New()
	ai, _ := repo.Upsert(context.Background(), domain.DailyStory{UserID: uid, Date: "2026-10-16", StoryDE: "Ein KI-Text."})

	if _, err := s.UpdateOwnStory(context.Background(), uid, ai.ID, manual(goodText, "перевод"), "ru"); !errors.Is(err, domain.ErrNotFound) {
		t.Errorf("update of an AI story: %v", err)
	}
	if err := s.DeleteOwnStory(context.Background(), uid, ai.ID); !errors.Is(err, domain.ErrNotFound) {
		t.Errorf("delete of an AI story: %v", err)
	}
	if _, ok := repo.own[ai.ID]; !ok {
		t.Error("the AI story is gone")
	}
	// Somebody else's own story is not found either.
	mine, _ := s.CreateOwnStory(context.Background(), uid, manual(goodText, "перевод"), "ru")
	other := uuid.New()
	if _, err := s.UpdateOwnStory(context.Background(), other, mine.ID, manual(goodText, "x"), "ru"); !errors.Is(err, domain.ErrNotFound) {
		t.Errorf("foreign update: %v", err)
	}
	if err := s.DeleteOwnStory(context.Background(), other, mine.ID); !errors.Is(err, domain.ErrNotFound) {
		t.Errorf("foreign delete: %v", err)
	}
	if err := s.DeleteOwnStory(context.Background(), uid, mine.ID); err != nil {
		t.Errorf("delete: %v", err)
	}
	if _, err := s.ByID(context.Background(), uid, mine.ID, "ru"); !errors.Is(err, domain.ErrNotFound) {
		t.Errorf("deleted story: %v", err)
	}
	// An AI story can be read by id (the archive opens it that way).
	if got, err := s.ByID(context.Background(), uid, ai.ID, "ru"); err != nil || got.Source != domain.StorySourceAI {
		t.Errorf("by id of an AI story: %+v %v", got, err)
	}
}

// An own story gets its translation language at creation (manual: the language of the translation the
// user wrote; auto: the request's), editing keeps it, and another interface language changes nothing.
func TestOwnStory_TranslationLangIsSetAtCreationAndKeptOnEdit(t *testing.T) {
	tr := newFakeTranslator()
	s, repo := ownService(tr)
	uid := uuid.New()

	manual, err := s.CreateOwnStory(context.Background(), uid, domain.OwnStoryInput{Text: goodText, TranslationMode: "manual", Translation: "Mening tarjimam"}, "uz")
	if err != nil || manual.TranslationLang != "uz" || repo.own[manual.ID].TranslationLang != "uz" || manual.StoryTranslation != "Mening tarjimam" {
		t.Fatalf("manual: %+v %v", manual, err)
	}
	auto, err := s.CreateOwnStory(context.Background(), uid, auto(goodText), "en")
	if err != nil || auto.TranslationLang != "en" || repo.own[auto.ID].TranslationLang != "en" {
		t.Fatalf("auto: %+v %v", auto, err)
	}

	// Editing from a UI in another language keeps the story's language and the user's translation.
	upd, err := s.UpdateOwnStory(context.Background(), uid, manual.ID,
		domain.OwnStoryInput{Title: "Neu", Text: goodText, TranslationMode: "manual", Translation: "Yangi tarjima"}, "ru")
	if err != nil || upd.TranslationLang != "uz" || upd.StoryTranslation != "Yangi tarjima" {
		t.Fatalf("edit: %+v %v", upd, err)
	}
	if _, ok := repo.cache[repo.key(manual.ID, "ru")]; ok {
		t.Error("a ru row appeared for a uz story")
	}
	// Viewing in ru returns the uz translation.
	if got, _ := s.ByID(context.Background(), uid, manual.ID, "ru"); got.StoryTranslation != "Yangi tarjima" || got.TranslationLang != "uz" {
		t.Errorf("view: %+v", got)
	}
}
