package handler

import (
	"context"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"learnwords/internal/domain"
	"learnwords/internal/service"
)

// storyRepo is just enough of a StoryRepository for the endpoints below: the day's words, one stored
// AI story, saving a generated story, an empty translation cache. Any other method panics (the
// embedded interface is nil), so a path that needs more fails loudly.
type storyRepo struct {
	service.StoryRepository
	old        domain.DailyStory // a story generated before the switch
	wordsCalls int
	saved      []domain.DailyStory
}

func newStoryRepo() *storyRepo {
	return &storyRepo{old: domain.DailyStory{ID: uuid.New(), Date: "2026-11-01", Title: "Alt", StoryDE: "Ein alter Text.",
		Source: domain.StorySourceAI, TranslationLang: "en", WordsUsed: []domain.StoryWord{}}}
}

func (r *storyRepo) WordsAddedOn(context.Context, uuid.UUID, string) ([]domain.StoryWord, error) {
	r.wordsCalls++
	return []domain.StoryWord{{Word: "der Hund", Lemma: "Hund", Article: "der", PartOfSpeech: "noun"}}, nil
}
func (r *storyRepo) Upsert(_ context.Context, s domain.DailyStory) (domain.DailyStory, error) {
	s.ID, s.Source = uuid.New(), domain.StorySourceAI
	r.saved = append(r.saved, s)
	return s, nil
}
func (r *storyRepo) SaveCorrections(context.Context, uuid.UUID, uuid.UUID, []domain.StoryCorrection) error {
	return nil
}
func (r *storyRepo) GetTranslation(context.Context, uuid.UUID, string) (domain.StoryTranslation, bool, error) {
	return domain.StoryTranslation{}, false, nil
}
func (r *storyRepo) ByDate(context.Context, uuid.UUID, string) (domain.DailyStory, error) {
	return r.old, nil
}
func (r *storyRepo) List(context.Context, uuid.UUID, int) ([]domain.DailyStory, error) {
	return []domain.DailyStory{r.old}, nil
}
func (r *storyRepo) ByID(_ context.Context, _, id uuid.UUID) (domain.DailyStory, error) {
	if id != r.old.ID {
		return domain.DailyStory{}, domain.ErrNotFound
	}
	return r.old, nil
}

// storyAI counts the calls to the story model.
type storyAI struct{ calls int }

func (g *storyAI) GenerateStory(context.Context, []domain.StoryWord, string) (domain.GeneratedStory, error) {
	g.calls++
	return domain.GeneratedStory{Title: "Der Hund", StoryDE: "Der **Hund** läuft nach Hause."}, nil
}

type storyEnv struct {
	r     *gin.Engine
	repo  *storyRepo
	ai    *storyAI
	feats *service.FeatureService
	user  uuid.UUID
}

// newStoryEnv: the story endpoints behind the real feature rules (catalog defaults + overrides).
func newStoryEnv() storyEnv {
	gin.SetMode(gin.TestMode)
	user := uuid.New()
	repo, ai := newStoryRepo(), &storyAI{}
	feats := service.NewFeatureService(&memFeatures{ov: map[string]domain.FeatureOverride{}})
	h := NewStoryHandler(service.NewStoryService(repo, ai, nil, nil), feats)
	r := gin.New()
	r.Use(func(c *gin.Context) { c.Set(userIDKey, user) }, NativeLang())
	r.POST("/stories/generate", h.Generate)
	r.GET("/stories/today", h.Today)
	r.GET("/stories", h.List)
	r.GET("/stories/by-id/:id", h.ByID)
	return storyEnv{r, repo, ai, feats, user}
}

// daily_story is off by default: Generate is refused before the story service is reached — no words
// read, no AI call, nothing saved.
func TestGenerate_DailyStoryOffByDefault_403AndNoServiceCall(t *testing.T) {
	e := newStoryEnv()
	w := sendJSON(e.r, "POST", "/stories/generate", `{"native_language":"en"}`)
	if w.Code != 403 || decode(t, w)["code"] != "feature_disabled" {
		t.Fatalf("%d %s", w.Code, w.Body)
	}
	if e.repo.wordsCalls != 0 || e.ai.calls != 0 || len(e.repo.saved) != 0 {
		t.Errorf("the story service was called: words %d, AI %d, saved %d", e.repo.wordsCalls, e.ai.calls, len(e.repo.saved))
	}
}

// A user_features row (daily_story, enabled = true) lets that user generate.
func TestGenerate_AdminTurnedDailyStoryOn_Generates(t *testing.T) {
	e := newStoryEnv()
	if err := e.feats.Set(context.Background(), e.user, domain.FeatureDailyStory, true, nil); err != nil {
		t.Fatal(err)
	}
	w := sendJSON(e.r, "POST", "/stories/generate", `{"genre":"сказка","native_language":"en"}`)
	if w.Code != 200 || decode(t, w)["title"] != "Der Hund" {
		t.Fatalf("%d %s", w.Code, w.Body)
	}
	if e.ai.calls != 1 || len(e.repo.saved) != 1 {
		t.Errorf("AI %d, saved %d; want one story", e.ai.calls, len(e.repo.saved))
	}
}

// Reading is not affected: with daily_story off, today's story, the archive and a story by id load.
func TestStories_ReadingWorksWithDailyStoryOff(t *testing.T) {
	e := newStoryEnv()
	for _, path := range []string{"/stories/today", "/stories", "/stories/by-id/" + e.repo.old.ID.String()} {
		w := httptest.NewRecorder()
		e.r.ServeHTTP(w, httptest.NewRequest("GET", path, nil))
		if w.Code != 200 || !strings.Contains(w.Body.String(), "Ein alter Text.") {
			t.Errorf("%s: %d %s", path, w.Code, w.Body)
		}
	}
	if e.ai.calls != 0 {
		t.Errorf("reading called the story model %d times", e.ai.calls)
	}
}
