package service

import (
	"context"
	"fmt"
	"strings"
	"testing"

	"github.com/google/uuid"

	"learnwords/internal/domain"
)

// fakeStoryRepo implements only the translation-cache half of StoryRepository for real;
// everything else is unused by resolveTranslation and just needs to satisfy the interface.
type fakeStoryRepo struct {
	cache map[string]domain.StoryTranslation // key: storyID.String()+":"+lang

	words       []domain.StoryWord // WordsAddedOn
	saved       []domain.DailyStory
	corrections []domain.StoryCorrection

	own   map[uuid.UUID]domain.DailyStory // own and AI stories by id (ByID, CreateOwn, ...)
	langs map[uuid.UUID]string            // translation_lang of stories that are not in `own`
}

func newFakeStoryRepo() *fakeStoryRepo {
	return &fakeStoryRepo{cache: map[string]domain.StoryTranslation{}, own: map[uuid.UUID]domain.DailyStory{}}
}

func (r *fakeStoryRepo) key(storyID uuid.UUID, lang string) string {
	return storyID.String() + ":" + lang
}

func (r *fakeStoryRepo) GetTranslation(_ context.Context, storyID uuid.UUID, lang string) (domain.StoryTranslation, bool, error) {
	v, ok := r.cache[r.key(storyID, lang)]
	return v, ok, nil
}

func (r *fakeStoryRepo) PutTranslation(_ context.Context, storyID uuid.UUID, lang string, tr domain.StoryTranslation) error {
	r.cache[r.key(storyID, lang)] = tr
	return nil
}

func (r *fakeStoryRepo) DeleteTranslation(_ context.Context, storyID uuid.UUID, lang string) error {
	delete(r.cache, r.key(storyID, lang))
	return nil
}

// FixTranslationLang mimics the conditional UPDATE: the first caller wins.
func (r *fakeStoryRepo) FixTranslationLang(_ context.Context, storyID uuid.UUID, lang string) (string, error) {
	if r.langs == nil {
		r.langs = map[uuid.UUID]string{}
	}
	if st, ok := r.own[storyID]; ok {
		if st.TranslationLang == "" {
			st.TranslationLang = lang
			r.own[storyID] = st
		}
		return st.TranslationLang, nil
	}
	if _, ok := r.langs[storyID]; !ok {
		r.langs[storyID] = lang
	}
	return r.langs[storyID], nil
}

func (r *fakeStoryRepo) ByID(_ context.Context, userID, id uuid.UUID) (domain.DailyStory, error) {
	st, ok := r.own[id]
	if !ok || st.UserID != userID {
		return domain.DailyStory{}, domain.ErrNotFound
	}
	return st, nil
}

func (r *fakeStoryRepo) CreateOwn(_ context.Context, s domain.DailyStory) (domain.DailyStory, error) {
	s.ID, s.Source, s.WordsUsed = uuid.New(), domain.StorySourceUser, []domain.StoryWord{}
	r.own[s.ID] = s
	return s, nil
}

func (r *fakeStoryRepo) UpdateOwn(_ context.Context, userID, id uuid.UUID, title, text string) (domain.DailyStory, error) {
	st, ok := r.own[id]
	if !ok || st.UserID != userID || st.Source != domain.StorySourceUser {
		return domain.DailyStory{}, domain.ErrNotFound
	}
	if st.StoryDE != text { // the real repository drops the cached translations of the old text
		for k := range r.cache {
			if strings.HasPrefix(k, id.String()+":") {
				delete(r.cache, k)
			}
		}
	}
	st.Title, st.StoryDE = title, text
	r.own[id] = st
	return st, nil
}

func (r *fakeStoryRepo) DeleteOwn(_ context.Context, userID, id uuid.UUID) error {
	st, ok := r.own[id]
	if !ok || st.UserID != userID || st.Source != domain.StorySourceUser {
		return domain.ErrNotFound
	}
	delete(r.own, id)
	return nil
}

func (r *fakeStoryRepo) WordsAddedOn(context.Context, uuid.UUID, string) ([]domain.StoryWord, error) {
	return r.words, nil
}
func (r *fakeStoryRepo) UsersWithWordsOn(context.Context, string) ([]uuid.UUID, error) {
	return nil, nil
}
func (r *fakeStoryRepo) LearningLanguage(context.Context, uuid.UUID) (string, error) {
	return "de", nil
}
func (r *fakeStoryRepo) Upsert(_ context.Context, s domain.DailyStory) (domain.DailyStory, error) {
	s.ID, s.Source = uuid.New(), domain.StorySourceAI
	r.saved = append(r.saved, s)
	r.own[s.ID] = s
	return s, nil
}
func (r *fakeStoryRepo) SaveCorrections(_ context.Context, _, _ uuid.UUID, cs []domain.StoryCorrection) error {
	r.corrections = append(r.corrections, cs...)
	return nil
}
func (r *fakeStoryRepo) ByDate(context.Context, uuid.UUID, string) (domain.DailyStory, error) {
	return domain.DailyStory{}, nil
}
func (r *fakeStoryRepo) List(context.Context, uuid.UUID, int) ([]domain.DailyStory, error) {
	return nil, nil
}

// fakeTranslator counts calls per (storyDE, lang) so tests can assert the model is never
// asked twice for something already cached, and returns a lang-tagged, deterministic result.
type fakeTranslator struct {
	calls map[string]int
}

func newFakeTranslator() *fakeTranslator { return &fakeTranslator{calls: map[string]int{}} }

func (f *fakeTranslator) TranslateStory(_ context.Context, _, nativeLang, storyDE string, words []string) (string, map[string]string, error) {
	f.calls[storyDE+":"+nativeLang]++
	glosses := make(map[string]string, len(words))
	for _, w := range words {
		glosses[w] = fmt.Sprintf("%s:%s", nativeLang, w)
	}
	return fmt.Sprintf("%s:%s", nativeLang, storyDE), glosses, nil
}

func newStory(id uuid.UUID) domain.DailyStory {
	return domain.DailyStory{
		ID: id, StoryDE: "Der Hund läuft.",
		WordsUsed: []domain.StoryWord{{Word: "Hund", Translation: "stale"}},
	}
}

// A story has ONE translation language: the first open fixes it, later requests for other
// languages get the same translation and never call the model again.
func TestResolveTranslation_FirstLanguageWins(t *testing.T) {
	repo := newFakeStoryRepo()
	tr := newFakeTranslator()
	s := &StoryService{repo: repo, translator: tr}
	id := uuid.New()

	for _, lang := range []string{"uz", "en", "ru"} {
		st := newStory(id) // re-read: the repository knows the fixed language, the struct may not
		s.resolveTranslation(context.Background(), &st, lang)
		if want := "uz:Der Hund läuft."; st.StoryTranslation != want {
			t.Errorf("requested %s: story translation = %q, want %q", lang, st.StoryTranslation, want)
		}
		if want := "uz:Hund"; st.WordsUsed[0].Translation != want {
			t.Errorf("requested %s: word gloss = %q, want %q", lang, st.WordsUsed[0].Translation, want)
		}
		if st.TranslationLang != "uz" || st.Language != "uz" {
			t.Errorf("requested %s: lang = %q / %q, want uz", lang, st.TranslationLang, st.Language)
		}
	}
	if n := len(tr.calls); n != 1 {
		t.Errorf("model calls: %v, want exactly one (story, uz)", tr.calls)
	}
}

// A story that already has translation_lang 'ru' asked in 'uz': the ru translation, no AI call.
func TestResolveTranslation_FixedLangIgnoresRequest(t *testing.T) {
	repo := newFakeStoryRepo()
	tr := newFakeTranslator()
	s := &StoryService{repo: repo, translator: tr}
	st := newStory(uuid.New())
	st.TranslationLang = "ru"
	repo.cache[repo.key(st.ID, "ru")] = domain.StoryTranslation{Translation: "russisch", WordGlosses: map[string]string{"Hund": "собака"}}
	s.resolveTranslation(context.Background(), &st, "uz")
	if st.StoryTranslation != "russisch" || st.WordsUsed[0].Translation != "собака" || st.TranslationLang != "ru" {
		t.Errorf("got %+v", st)
	}
	if len(tr.calls) != 0 {
		t.Errorf("AI called: %v", tr.calls)
	}
}

// A story with no language yet, first opened in 'uz': translated to uz once, translation_lang saved;
// a later 'ru' request returns uz without an AI call.
func TestResolveTranslation_NullStoryIsFixedByFirstOpen(t *testing.T) {
	repo := newFakeStoryRepo()
	tr := newFakeTranslator()
	s := &StoryService{repo: repo, translator: tr}
	st := newStory(uuid.New())
	repo.own[st.ID] = st // stored with translation_lang NULL
	first := repo.own[st.ID]
	s.resolveTranslation(context.Background(), &first, "uz")
	if first.TranslationLang != "uz" || first.StoryTranslation != "uz:Der Hund läuft." {
		t.Fatalf("first open: %+v", first)
	}
	if repo.own[st.ID].TranslationLang != "uz" {
		t.Errorf("translation_lang not saved: %+v", repo.own[st.ID])
	}
	later := repo.own[st.ID]
	s.resolveTranslation(context.Background(), &later, "ru")
	if later.StoryTranslation != "uz:Der Hund läuft." || later.TranslationLang != "uz" {
		t.Errorf("later ru request: %+v", later)
	}
	if n := tr.calls["Der Hund läuft.:uz"]; n != 1 || len(tr.calls) != 1 {
		t.Errorf("AI calls: %v", tr.calls)
	}
}

// Generation fixes the language from the request; the cron leaves it empty.
func TestGenerate_SetsTranslationLangFromNativeLanguage(t *testing.T) {
	repo := newFakeStoryRepo()
	repo.words = append([]domain.StoryWord(nil), storyWords...)
	s := NewStoryService(repo, &fakeStoryGen{story: rawStory}, newFakeTranslator(), nil)
	st, err := s.GenerateDailyStory(deCtx(), uuid.New(), "", "uz")
	if err != nil || st == nil {
		t.Fatal(st, err)
	}
	if repo.saved[0].TranslationLang != "uz" || st.TranslationLang != "uz" {
		t.Errorf("saved %q, returned %q, want uz", repo.saved[0].TranslationLang, st.TranslationLang)
	}
	cron, err := s.generateFor(deCtx(), uuid.New(), "2026-10-14", "", "")
	if err != nil || cron == nil || repo.saved[1].TranslationLang != "" {
		t.Errorf("cron story must stay NULL: %+v %v", repo.saved, err)
	}
}

// A repeat request for a language already resolved must hit the cache, not the model again.
func TestResolveTranslation_CachedNoSecondModelCall(t *testing.T) {
	repo := newFakeStoryRepo()
	tr := newFakeTranslator()
	s := &StoryService{repo: repo, translator: tr}
	id := uuid.New()

	for i := 0; i < 3; i++ {
		st := newStory(id)
		s.resolveTranslation(context.Background(), &st, "uz")
	}
	if got := tr.calls["Der Hund läuft.:uz"]; got != 1 {
		t.Errorf("model called %d times for the same (story, lang), want 1", got)
	}
}

// No translator configured (no AI key) and nothing cached yet: the German text is still shown,
// the translation is just left empty rather than guessing a language.
func TestResolveTranslation_NoTranslatorLeavesEmpty(t *testing.T) {
	repo := newFakeStoryRepo()
	s := &StoryService{repo: repo, translator: nil}
	st := newStory(uuid.New())
	s.resolveTranslation(context.Background(), &st, "uz")
	if st.StoryTranslation != "" {
		t.Errorf("story translation = %q, want empty", st.StoryTranslation)
	}
	if st.WordsUsed[0].Translation != "" {
		t.Errorf("word translation = %q, want empty (not the stale stored value) when nothing could be resolved", st.WordsUsed[0].Translation)
	}
	if st.Language != "uz" {
		t.Errorf("Language = %q, want %q (still records what was requested)", st.Language, "uz")
	}
}
