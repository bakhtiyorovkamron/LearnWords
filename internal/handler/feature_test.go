package handler

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"learnwords/internal/domain"
	"learnwords/internal/service"
)

type memFeatures struct {
	mu    sync.Mutex
	ov    map[string]domain.FeatureOverride
	count map[string]int // feature → used (one day is enough for these tests)
}

func (r *memFeatures) Overrides(context.Context, uuid.UUID) (map[string]domain.FeatureOverride, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := map[string]domain.FeatureOverride{}
	for k, v := range r.ov {
		out[k] = v
	}
	return out, nil
}
func (r *memFeatures) Usage(context.Context, uuid.UUID, string) (map[string]int, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := map[string]int{}
	for k, v := range r.count {
		out[k] = v
	}
	return out, nil
}
func (r *memFeatures) Consume(_ context.Context, _ uuid.UUID, f, _ string, n, limit int) (int, bool, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.count[f]+n > limit {
		return 0, false, nil
	}
	if r.count == nil {
		r.count = map[string]int{}
	}
	r.count[f] += n
	return r.count[f], true, nil
}
func (r *memFeatures) Refund(_ context.Context, _ uuid.UUID, f, _ string, n int) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.count[f] = max(r.count[f]-n, 0)
	return nil
}
func (r *memFeatures) SetOverride(_ context.Context, _ uuid.UUID, f string, en bool, l *int) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.ov[f] = domain.FeatureOverride{Enabled: en, DailyLimit: l}
	return nil
}

type fakeUsers struct{ known map[uuid.UUID]bool }

func (f fakeUsers) GetByID(_ context.Context, id uuid.UUID) (*domain.User, error) {
	if !f.known[id] {
		return nil, domain.ErrNotFound
	}
	return &domain.User{ID: id, Email: "a@b", Role: domain.RoleUser, LearningLanguage: "de"}, nil
}

type featureEnv struct {
	r     *gin.Engine
	feats *service.FeatureService
	user  uuid.UUID
}

func newFeatureEnv() featureEnv {
	gin.SetMode(gin.TestMode)
	user := uuid.New()
	feats := service.NewFeatureService(&memFeatures{ov: map[string]domain.FeatureOverride{}})
	r := gin.New()
	r.Use(func(c *gin.Context) { c.Set(userIDKey, user) }, NativeLang())
	stories := NewStoryHandler(service.NewStoryService(nil, nil, nil, nil), feats)
	admin := NewAdminHandler(nil, fakeUsers{known: map[uuid.UUID]bool{user: true}}, feats, newMemFeedback())
	r.POST("/stories/generate", stories.Generate)
	r.POST("/stories/own", stories.CreateOwn)
	r.PUT("/stories/own/:id", stories.UpdateOwn)
	r.POST("/search-word", NewSearchHandler(nil, feats).Search)
	r.GET("/me", admin.Me)
	r.GET("/admin/users/:id/features", admin.UserFeatures)
	r.PUT("/admin/users/:id/features/:feature", admin.SetUserFeature)
	return featureEnv{r, feats, user}
}

func (e featureEnv) off(t *testing.T, feature string) {
	t.Helper()
	if err := e.feats.Set(context.Background(), e.user, feature, false, nil); err != nil {
		t.Fatal(err)
	}
}

func decode(t *testing.T, w *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var m map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &m); err != nil {
		t.Fatalf("body %q: %v", w.Body.String(), err)
	}
	return m
}

func TestFeatureDisabled_Is403WithCode(t *testing.T) {
	e := newFeatureEnv()
	e.off(t, domain.FeatureDailyStory)
	e.off(t, domain.FeatureWordSearch)
	for _, path := range []string{"/stories/generate", "/search-word"} {
		w := sendJSON(e.r, "POST", path, `{"query":"Hund"}`)
		if w.Code != 403 || decode(t, w)["code"] != "feature_disabled" {
			t.Errorf("%s: %d %s", path, w.Code, w.Body)
		}
	}
}

func TestOwnStory_AutoNeedsAutotranslate_ManualDoesNot(t *testing.T) {
	e := newFeatureEnv()
	e.off(t, domain.FeatureStoryAutotranslate)
	id := uuid.NewString()
	auto := `{"text":"Der Hund läuft durch den Park.","translation_mode":"auto"}`
	// manual without a translation is a validation error (400) — i.e. it got past the feature gate.
	manual := `{"text":"Der Hund läuft durch den Park.","translation_mode":"manual"}`

	for name, c := range map[string]struct{ method, path, body string }{
		"create": {"POST", "/stories/own", auto},
		"update": {"PUT", "/stories/own/" + id, auto},
	} {
		w := sendJSON(e.r, c.method, c.path, c.body)
		if w.Code != 403 || decode(t, w)["code"] != "feature_disabled" {
			t.Errorf("%s auto: %d %s", name, w.Code, w.Body)
		}
	}
	for name, c := range map[string]struct{ method, path string }{
		"create": {"POST", "/stories/own"},
		"update": {"PUT", "/stories/own/" + id},
	} {
		if w := sendJSON(e.r, c.method, c.path, manual); w.Code != 400 {
			t.Errorf("%s manual must pass the gate (400 translation required): %d %s", name, w.Code, w.Body)
		}
	}
}

func TestMe_ContainsFeatures(t *testing.T) {
	e := newFeatureEnv()
	e.off(t, domain.FeatureWordSearch)
	w := httptest.NewRecorder()
	e.r.ServeHTTP(w, httptest.NewRequest("GET", "/me", nil))
	if w.Code != 200 {
		t.Fatal(w.Code, w.Body)
	}
	f, _ := decode(t, w)["features"].(map[string]any)
	if len(f) != 4 {
		t.Fatalf("features: %v", f)
	}
	p := f["photo_import"].(map[string]any)
	if p["enabled"] != true || p["daily_limit"] != float64(4) || p["remaining"] != float64(4) {
		t.Errorf("photo_import: %v", p)
	}
	if f["word_search"].(map[string]any)["enabled"] != false {
		t.Errorf("word_search must be off: %v", f["word_search"])
	}
	if d := f["daily_story"].(map[string]any); d["daily_limit"] != nil || d["remaining"] != nil {
		t.Errorf("daily_story is unlimited: %v", d)
	}
}

func TestAdminSetFeature(t *testing.T) {
	e := newFeatureEnv()
	base := "/admin/users/" + e.user.String() + "/features/"

	w := sendJSON(e.r, "PUT", base+"photo_import", `{"enabled":true,"daily_limit":7}`)
	st := decode(t, w)
	if w.Code != 200 || st["daily_limit"] != float64(7) || st["limit_override"] != float64(7) || st["default_limit"] != float64(4) {
		t.Errorf("set limit: %d %s", w.Code, w.Body)
	}
	w = sendJSON(e.r, "PUT", base+"photo_import", `{"enabled":false,"daily_limit":null}`)
	st = decode(t, w)
	if w.Code != 200 || st["enabled"] != false || st["daily_limit"] != float64(4) || st["limit_override"] != nil {
		t.Errorf("null limit = default: %d %s", w.Code, w.Body)
	}

	for name, c := range map[string]struct {
		path, body string
		want       int
	}{
		"unknown feature": {base + "nope", `{"enabled":true}`, 400},
		"negative limit":  {base + "photo_import", `{"enabled":true,"daily_limit":-1}`, 400},
		"missing enabled": {base + "photo_import", `{"daily_limit":3}`, 400},
		"bad json":        {base + "photo_import", `{`, 400},
		"bad user id":     {"/admin/users/x/features/photo_import", `{"enabled":true}`, 400},
		"unknown user":    {"/admin/users/" + uuid.NewString() + "/features/photo_import", `{"enabled":true}`, 404},
	} {
		if w := sendJSON(e.r, "PUT", c.path, c.body); w.Code != c.want {
			t.Errorf("%s: %d, want %d (%s)", name, w.Code, c.want, strings.TrimSpace(w.Body.String()))
		}
	}

	w = httptest.NewRecorder()
	e.r.ServeHTTP(w, httptest.NewRequest("GET", "/admin/users/"+e.user.String()+"/features", nil))
	if fs, _ := decode(t, w)["features"].([]any); w.Code != 200 || len(fs) != 4 {
		t.Errorf("list: %d %s", w.Code, w.Body)
	}
}

func TestDailyLimitError_Is429WithLimit(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.GET("/x", func(c *gin.Context) { writeError(c, &domain.DailyLimitError{Limit: 4}) })
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest("GET", "/x", nil))
	m := decode(t, w)
	if w.Code != 429 || m["code"] != "daily_limit" || m["limit"] != float64(4) {
		t.Errorf("%d %s", w.Code, w.Body)
	}
}
