package service

import (
	"context"
	"fmt"
	"testing"

	"github.com/google/uuid"

	"learnwords/internal/domain"
)

// fakeStoryRepo implements only the translation-cache half of StoryRepository for real;
// everything else is unused by resolveTranslation and just needs to satisfy the interface.
type fakeStoryRepo struct {
	cache map[string]domain.StoryTranslation // key: storyID.String()+":"+lang
}

func newFakeStoryRepo() *fakeStoryRepo {
	return &fakeStoryRepo{cache: map[string]domain.StoryTranslation{}}
}

func (r *fakeStoryRepo) key(storyID uuid.UUID, lang string) string {
	return storyID.String() + ":" + lang
}

func (r *fakeStoryRepo) GetTranslation(_ context.Context, storyID uuid.UUID, lang string) (string, map[string]string, bool, error) {
	v, ok := r.cache[r.key(storyID, lang)]
	if !ok {
		return "", nil, false, nil
	}
	return v.Translation, v.WordGlosses, true, nil
}

func (r *fakeStoryRepo) PutTranslation(_ context.Context, storyID uuid.UUID, lang, translation string, wordGlosses map[string]string) error {
	r.cache[r.key(storyID, lang)] = domain.StoryTranslation{Translation: translation, WordGlosses: wordGlosses}
	return nil
}

func (r *fakeStoryRepo) WordsAddedOn(context.Context, uuid.UUID, string) ([]domain.StoryWord, error) {
	return nil, nil
}
func (r *fakeStoryRepo) UsersWithWordsOn(context.Context, string) ([]uuid.UUID, error) {
	return nil, nil
}
func (r *fakeStoryRepo) LearningLanguage(context.Context, uuid.UUID) (string, error) {
	return "de", nil
}
func (r *fakeStoryRepo) Upsert(_ context.Context, s domain.DailyStory) (domain.DailyStory, error) {
	return s, nil
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

// Same story_id, three native languages → three independent, correctly-tagged translations
// (no cross-language bleed, each generated once).
func TestResolveTranslation_PerLanguage(t *testing.T) {
	repo := newFakeStoryRepo()
	tr := newFakeTranslator()
	s := &StoryService{repo: repo, translator: tr}
	id := uuid.New()

	for _, lang := range []string{"uz", "en", "ru"} {
		st := newStory(id)
		s.resolveTranslation(context.Background(), &st, lang)
		if want := lang + ":Der Hund läuft."; st.StoryTranslation != want {
			t.Errorf("lang %s: story translation = %q, want %q", lang, st.StoryTranslation, want)
		}
		if want := lang + ":Hund"; st.WordsUsed[0].Translation != want {
			t.Errorf("lang %s: word gloss = %q, want %q", lang, st.WordsUsed[0].Translation, want)
		}
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
