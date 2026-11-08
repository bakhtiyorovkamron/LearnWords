package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"learnwords/internal/domain"
	"learnwords/internal/service"
)

// defaultPhotoLimit mirrors the catalog default of photo_import.
const defaultPhotoLimit = 5

type memFeatures struct {
	mu      sync.Mutex
	ov      map[string]domain.FeatureOverride
	count   map[string]int // feature → used (one day and one user are enough for these tests)
	credits map[string]int // user|feature → purchased balance
	users   map[uuid.UUID]bool
}

func creditKey(u uuid.UUID, feature string) string { return u.String() + "|" + feature }

// knowUser makes u exist for AddCredits (unknown users are ErrNotFound once any user is known).
func (r *memFeatures) knowUser(u uuid.UUID) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.users == nil {
		r.users = map[uuid.UUID]bool{}
	}
	r.users[u] = true
}

func (r *memFeatures) balance(u uuid.UUID, feature string) int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.credits[creditKey(u, feature)]
}

func (r *memFeatures) Credits(_ context.Context, u uuid.UUID) (map[string]int, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := map[string]int{}
	for _, spec := range domain.FeatureCatalog {
		if n, ok := r.credits[creditKey(u, spec.Name)]; ok {
			out[spec.Name] = n
		}
	}
	return out, nil
}

func (r *memFeatures) AddCredits(_ context.Context, u uuid.UUID, feature string, delta int, _ string, _, _ *uuid.UUID, _ string) (int, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.users != nil && !r.users[u] {
		return 0, domain.ErrNotFound
	}
	if r.credits == nil {
		r.credits = map[string]int{}
	}
	k := creditKey(u, feature)
	if r.credits[k]+delta < 0 {
		return 0, domain.ErrValidation
	}
	r.credits[k] += delta
	return r.credits[k], nil
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
func (r *memFeatures) Consume(_ context.Context, u uuid.UUID, f, day string, n, limit int) (domain.ConsumeResult, bool, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.count == nil {
		r.count = map[string]int{}
	}
	if r.credits == nil {
		r.credits = map[string]int{}
	}
	k := creditKey(u, f)
	left := max(limit-r.count[f], 0)
	res := domain.ConsumeResult{FromDaily: min(n, left), Day: day}
	res.FromCredits = n - res.FromDaily
	if res.FromCredits > r.credits[k] {
		return domain.ConsumeResult{DailyRemaining: &left, Credits: r.credits[k], Day: day}, false, nil
	}
	r.count[f] += res.FromDaily
	r.credits[k] -= res.FromCredits
	rem := left - res.FromDaily
	res.DailyRemaining, res.Credits = &rem, r.credits[k]
	return res, true, nil
}
func (r *memFeatures) Refund(_ context.Context, u uuid.UUID, f, _ string, res domain.ConsumeResult) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.count[f] = max(r.count[f]-res.FromDaily, 0)
	if res.FromCredits > 0 {
		r.credits[creditKey(u, f)] += res.FromCredits
	}
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
	mem   *memFeatures
	user  uuid.UUID
}

func newFeatureEnv() featureEnv {
	gin.SetMode(gin.TestMode)
	user := uuid.New()
	mem := &memFeatures{ov: map[string]domain.FeatureOverride{}}
	feats := service.NewFeatureService(mem)
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
	return featureEnv{r, feats, mem, user}
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
	if _, err := e.mem.AddCredits(context.Background(), e.user, domain.FeaturePhotoImport, 12, domain.CreditAdmin, nil, nil, ""); err != nil {
		t.Fatal(err)
	}
	w := httptest.NewRecorder()
	e.r.ServeHTTP(w, httptest.NewRequest("GET", "/me", nil))
	if w.Code != 200 {
		t.Fatal(w.Code, w.Body)
	}
	f, _ := decode(t, w)["features"].(map[string]any)
	if len(f) != 5 {
		t.Fatalf("features: %v", f)
	}
	if f["theme_picker"].(map[string]any)["enabled"] != true {
		t.Errorf("theme_picker is on by default: %v", f["theme_picker"])
	}
	p := f["photo_import"].(map[string]any)
	if p["enabled"] != true || p["daily_limit"] != float64(defaultPhotoLimit) || p["remaining"] != float64(defaultPhotoLimit) || p["credits"] != float64(12) {
		t.Errorf("photo_import: %v", p)
	}
	if c, ok := f["word_search"].(map[string]any)["credits"]; !ok || c != float64(0) {
		t.Errorf("credits are there for every feature, 0 without a purchase: %v", f["word_search"])
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
	if w.Code != 200 || st["daily_limit"] != float64(7) || st["limit_override"] != float64(7) || st["default_limit"] != float64(defaultPhotoLimit) {
		t.Errorf("set limit: %d %s", w.Code, w.Body)
	}
	w = sendJSON(e.r, "PUT", base+"photo_import", `{"enabled":false,"daily_limit":null}`)
	st = decode(t, w)
	if w.Code != 200 || st["enabled"] != false || st["daily_limit"] != float64(defaultPhotoLimit) || st["limit_override"] != nil {
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
	if fs, _ := decode(t, w)["features"].([]any); w.Code != 200 || len(fs) != 5 {
		t.Errorf("list: %d %s", w.Code, w.Body)
	}
}

func TestDailyLimitError_Is429WithLimitAndCredits(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for name, c := range map[string]struct {
		err     error
		credits float64
	}{
		"no credits":   {&domain.DailyLimitError{Limit: 4}, 0},
		"some credits": {&domain.DailyLimitError{Limit: 4, Credits: 2}, 2}, // n > what is left of both
		"wrapped":      {fmt.Errorf("photo: %w", &domain.DailyLimitError{Limit: 4, Credits: 3}), 3},
	} {
		r := gin.New()
		r.GET("/x", func(ctx *gin.Context) { writeError(ctx, c.err) })
		w := httptest.NewRecorder()
		r.ServeHTTP(w, httptest.NewRequest("GET", "/x", nil))
		m := decode(t, w)
		// credits is always in the body, also when it is 0
		if got, ok := m["credits"]; w.Code != 429 || m["code"] != "daily_limit" || m["limit"] != float64(4) || !ok || got != c.credits {
			t.Errorf("%s: %d %s", name, w.Code, w.Body)
		}
	}
}
