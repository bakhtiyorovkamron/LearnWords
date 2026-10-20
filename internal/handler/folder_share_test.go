package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"learnwords/internal/domain"
)

type fakeShared struct {
	folder  *domain.SharedFolder
	err     error
	gotLang string
	gotTok  string
	gotCall string // caller's language
}

func (f *fakeShared) GetShared(_ context.Context, token, lang string) (*domain.SharedFolder, error) {
	f.gotTok, f.gotLang = token, lang
	return f.folder, f.err
}
func (f *fakeShared) ImportShared(ctx context.Context, _ uuid.UUID, callerLang, token string, _ int) (*domain.ImportResult, error) {
	f.gotTok, f.gotCall = token, callerLang
	if f.err != nil {
		return nil, f.err
	}
	return &domain.ImportResult{FolderID: uuid.New(), Added: 3, Skipped: 1}, nil
}

const goodToken = "aB3dE5gH7k"

func sharedRouter(f *fakeShared, callerLang string) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	h := NewSharedHandler(f)
	r.GET("/api/shared/:token", h.Get) // public: no user in the context at all
	r.POST("/api/shared/:token/import", func(c *gin.Context) {
		c.Set(userIDKey, uuid.New())
		c.Request = c.Request.WithContext(domain.WithLang(c.Request.Context(), callerLang))
		c.Next()
	}, h.Import)
	return r
}

func do(r *gin.Engine, method, path string, hdr map[string]string) *httptest.ResponseRecorder {
	w := httptest.NewRecorder()
	req := httptest.NewRequest(method, path, nil)
	for k, v := range hdr {
		req.Header.Set(k, v)
	}
	r.ServeHTTP(w, req)
	return w
}

func TestSharedGet_PublicNoLeak(t *testing.T) {
	art := "der"
	f := &fakeShared{folder: &domain.SharedFolder{Name: "Tiere", Color: "amber", Language: "de", WordCount: 1,
		Words: []domain.SharedWord{{Word: "der Hund", Article: &art, Translation: "собака"}}}}
	w := do(sharedRouter(f, "de"), http.MethodGet, "/api/shared/"+goodToken+"?lang=uz", nil) // no Authorization header
	if w.Code != 200 {
		t.Fatalf("%d %s", w.Code, w.Body)
	}
	var out map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	for _, banned := range []string{"user_id", "email", "id", "box_level", "is_learned", "next_review_at"} {
		if _, ok := out[banned]; ok {
			t.Errorf("response has %q", banned)
		}
		for _, word := range out["words"].([]any) {
			if _, ok := word.(map[string]any)[banned]; ok {
				t.Errorf("word has %q", banned)
			}
		}
	}
	if out["name"] != "Tiere" || out["word_count"].(float64) != 1 {
		t.Errorf("body: %s", w.Body)
	}
	if w.Header().Get("Cache-Control") != "no-store" {
		t.Error("a turned-off link must stop working at once: no-store expected")
	}
	if f.gotLang != "uz" || f.gotTok != goodToken {
		t.Errorf("store got token %q lang %q", f.gotTok, f.gotLang)
	}
}

func TestSharedGet_LanguageFromAcceptLanguage(t *testing.T) {
	f := &fakeShared{folder: &domain.SharedFolder{Words: []domain.SharedWord{}}}
	r := sharedRouter(f, "de")
	for hdr, want := range map[string]string{
		"en-US,en;q=0.9": "en", "fr-FR,uz;q=0.8": "uz", "de-DE": "", "": "", "RU": "ru",
	} {
		do(r, http.MethodGet, "/api/shared/"+goodToken, map[string]string{"Accept-Language": hdr})
		if f.gotLang != want {
			t.Errorf("Accept-Language %q → %q, want %q", hdr, f.gotLang, want)
		}
	}
	do(r, http.MethodGet, "/api/shared/"+goodToken+"?lang=ru", map[string]string{"Accept-Language": "en"})
	if f.gotLang != "ru" {
		t.Errorf("?lang wins: %q", f.gotLang)
	}
}

func TestSharedGet_UnknownDisabledOrMalformedToken_404(t *testing.T) {
	f := &fakeShared{err: domain.ErrNotFound} // what the store says for an unknown or turned-off token
	r := sharedRouter(f, "de")
	if w := do(r, http.MethodGet, "/api/shared/"+goodToken, nil); w.Code != 404 {
		t.Errorf("disabled/unknown: %d", w.Code)
	}
	f.gotTok = ""
	for _, bad := range []string{"short", "waytoolongtoken1", "bad-token!", "aB3dE5gH7;"} {
		if w := do(r, http.MethodGet, "/api/shared/"+bad, nil); w.Code != 404 {
			t.Errorf("%q: %d", bad, w.Code)
		}
	}
	if f.gotTok != "" {
		t.Error("a malformed token must not reach the database")
	}
}

func TestSharedImport_Outcomes(t *testing.T) {
	own := uuid.New()
	cases := []struct {
		name string
		err  error
		code int
		body string
	}{
		{"ok", nil, 200, `"added":3`},
		{"unknown token", domain.ErrNotFound, 404, ""},
		{"own folder", &domain.OwnFolderError{FolderID: own}, 409, `"code":"own_folder","folder_id":"` + own.String() + `"`},
		{"language mismatch", domain.ErrLangMismatch, 422, `"code":"lang_mismatch"`},
		{"too many folders", domain.ErrValidation, 400, ""},
	}
	for _, c := range cases {
		f := &fakeShared{err: c.err}
		w := do(sharedRouter(f, "ko"), http.MethodPost, "/api/shared/"+goodToken+"/import", nil)
		if w.Code != c.code || !strings.Contains(w.Body.String(), c.body) {
			t.Errorf("%s: %d %s", c.name, w.Code, w.Body)
		}
		if f.gotCall != "ko" {
			t.Errorf("%s: the caller's learning language must come from the context, got %q", c.name, f.gotCall)
		}
	}
	// A malformed token is a 404 before any lookup.
	f := &fakeShared{}
	if w := do(sharedRouter(f, "de"), http.MethodPost, "/api/shared/nope/import", nil); w.Code != 404 || f.gotTok != "" {
		t.Errorf("malformed: %d", w.Code)
	}
}

// --- owner endpoints -----------------------------------------------------------------------

type fakeFolderShare struct {
	FolderStore
	token string
	err   error
}

func (f *fakeFolderShare) EnableShare(context.Context, uuid.UUID, uuid.UUID) (string, error) {
	return f.token, f.err
}
func (f *fakeFolderShare) RegenerateShare(context.Context, uuid.UUID, uuid.UUID) (string, error) {
	return f.token, f.err
}
func (f *fakeFolderShare) DisableShare(context.Context, uuid.UUID, uuid.UUID) error { return f.err }

func TestFolderShareEndpoints(t *testing.T) {
	gin.SetMode(gin.TestMode)
	run := func(f *fakeFolderShare, method, suffix string, hdr map[string]string) *httptest.ResponseRecorder {
		r := gin.New()
		r.Use(func(c *gin.Context) { c.Set(userIDKey, uuid.New()) })
		h := NewFolderHandler(f)
		r.POST("/folders/:id/share", h.EnableShare)
		r.POST("/folders/:id/share/regenerate", h.RegenerateShare)
		r.DELETE("/folders/:id/share", h.DisableShare)
		w := httptest.NewRecorder()
		req := httptest.NewRequest(method, "/folders/"+uuid.NewString()+suffix, nil)
		req.Host = "yodla.fun"
		for k, v := range hdr {
			req.Header.Set(k, v)
		}
		r.ServeHTTP(w, req)
		return w
	}

	ok := &fakeFolderShare{token: goodToken}
	w := run(ok, http.MethodPost, "/share", map[string]string{"X-Forwarded-Proto": "https"})
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"token":"`+goodToken+`"`) ||
		!strings.Contains(w.Body.String(), `"url":"https://yodla.fun/s/`+goodToken+`"`) {
		t.Errorf("enable: %d %s", w.Code, w.Body)
	}
	if w := run(ok, http.MethodPost, "/share/regenerate", nil); w.Code != 200 {
		t.Errorf("regenerate: %d", w.Code)
	}
	if w := run(ok, http.MethodDelete, "/share", nil); w.Code != 204 {
		t.Errorf("disable: %d", w.Code)
	}

	// Not the owner's folder (the store answers ErrNotFound): 404 for all three.
	foreign := &fakeFolderShare{err: domain.ErrNotFound}
	for _, c := range []struct{ method, suffix string }{
		{http.MethodPost, "/share"}, {http.MethodPost, "/share/regenerate"}, {http.MethodDelete, "/share"},
	} {
		if w := run(foreign, c.method, c.suffix, nil); w.Code != 404 {
			t.Errorf("%s %s by a non-owner: %d", c.method, c.suffix, w.Code)
		}
	}
}

// Wiring in the real router: the preview is public, the import and the owner actions need a login.
func TestSharedRoutes_Wiring(t *testing.T) {
	gin.SetMode(gin.TestMode)
	f := &fakeShared{folder: &domain.SharedFolder{Name: "Tiere", Words: []domain.SharedWord{}}}
	r := NewRouter(RouterDeps{Shared: NewSharedHandler(f), Folders: &FolderHandler{}, CORSOrigins: []string{"http://localhost"}, Ctx: context.Background()})
	if w := do(r, http.MethodGet, "/api/shared/"+goodToken, nil); w.Code != 200 {
		t.Errorf("public preview without a token: %d %s", w.Code, w.Body)
	}
	for _, c := range []struct{ method, path string }{
		{http.MethodPost, "/api/shared/" + goodToken + "/import"},
		{http.MethodPost, "/api/folders/" + uuid.NewString() + "/share"},
		{http.MethodPost, "/api/folders/" + uuid.NewString() + "/share/regenerate"},
		{http.MethodDelete, "/api/folders/" + uuid.NewString() + "/share"},
	} {
		if w := do(r, c.method, c.path, nil); w.Code != http.StatusUnauthorized {
			t.Errorf("%s %s without login: %d, want 401", c.method, c.path, w.Code)
		}
	}
}
