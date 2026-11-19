package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"learnwords/internal/domain"
	"learnwords/internal/service"
)

type fakeGames struct {
	err    error
	calls  int
	folder *domain.FolderFilter
	game   string
	score  int
	of     *int
}

func (f *fakeGames) Records(_ context.Context, _ uuid.UUID, folder *domain.FolderFilter) ([]domain.GameRecord, error) {
	f.calls++
	f.folder = folder
	return []domain.GameRecord{{Game: domain.GamePairs, Best: 41_000, Plays: 2}}, f.err
}

func (f *fakeGames) SaveResult(_ context.Context, _ uuid.UUID, folder *domain.FolderFilter, game string, score int, of *int) (service.GameResult, error) {
	f.calls++
	f.folder, f.game, f.score, f.of = folder, game, score, of
	prev := 45_000
	return service.GameResult{Record: domain.GameRecord{Game: game, Best: score, BestOf: of, Plays: 3}, NewRecord: true, Previous: &prev}, f.err
}

// gate is a FeatureGate that only lets the features in `on` through.
type gate map[string]bool

func (g gate) Require(_ context.Context, _ uuid.UUID, feature string) error {
	if !g[feature] {
		return domain.ErrFeatureDisabled
	}
	return nil
}

func gameRouter(f *fakeGames, on bool) *gin.Engine {
	gin.SetMode(gin.TestMode)
	h := NewGameHandler(f, gate{domain.FeatureFolderGames: on})
	r := gin.New()
	r.Use(func(c *gin.Context) { c.Set(userIDKey, uuid.New()) })
	r.GET("/games/records", h.Records)
	r.POST("/games/result", h.Result)
	return r
}

func gameRequest(r *gin.Engine, method, path, body string) *httptest.ResponseRecorder {
	w := httptest.NewRecorder()
	req := httptest.NewRequest(method, path, bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)
	return w
}

func TestGameHandler_FlagOff_403_ServiceNotCalled(t *testing.T) {
	f := &fakeGames{}
	r := gameRouter(f, false)
	for _, c := range [][3]string{
		{http.MethodGet, "/games/records?folder_id=all", ""},
		{http.MethodPost, "/games/result", `{"game":"pairs","folder_id":"all","score":30000}`},
		{http.MethodPost, "/games/result", `{`}, // the flag comes before the body
	} {
		w := gameRequest(r, c[0], c[1], c[2])
		var res struct{ Code string }
		json.Unmarshal(w.Body.Bytes(), &res) //nolint:errcheck
		if w.Code != http.StatusForbidden || res.Code != "feature_disabled" {
			t.Errorf("%s %s: %d %s", c[0], c[1], w.Code, w.Body)
		}
	}
	if f.calls != 0 {
		t.Errorf("the service was called %d times with the flag off", f.calls)
	}
}

func TestGameHandler_Records(t *testing.T) {
	folder := uuid.New()
	for query, want := range map[string]*domain.FolderFilter{
		"":                              nil,
		"?folder_id=all":                nil,
		"?folder_id=none":               {None: true},
		"?folder_id=" + folder.String(): {ID: folder},
	} {
		f := &fakeGames{}
		w := gameRequest(gameRouter(f, true), http.MethodGet, "/games/records"+query, "")
		var res struct{ Records []domain.GameRecord }
		if json.Unmarshal(w.Body.Bytes(), &res); w.Code != 200 || len(res.Records) != 1 || res.Records[0].Best != 41_000 {
			t.Errorf("%q: %d %s", query, w.Code, w.Body)
		}
		if (want == nil) != (f.folder == nil) || (want != nil && *want != *f.folder) {
			t.Errorf("%q: folder %+v, want %+v", query, f.folder, want)
		}
	}

	if w := gameRequest(gameRouter(&fakeGames{}, true), http.MethodGet, "/games/records?folder_id=x", ""); w.Code != http.StatusBadRequest {
		t.Errorf("bad folder: %d", w.Code)
	}
	if w := gameRequest(gameRouter(&fakeGames{err: domain.ErrNotFound}, true), http.MethodGet, "/games/records?folder_id="+folder.String(), ""); w.Code != http.StatusNotFound {
		t.Errorf("foreign folder: %d", w.Code)
	}
}

func TestGameHandler_Result(t *testing.T) {
	folder := uuid.New()
	f := &fakeGames{}
	w := gameRequest(gameRouter(f, true), http.MethodPost, "/games/result",
		`{"game":"articles","folder_id":"`+folder.String()+`","score":17,"of":20}`)
	if w.Code != 200 || f.game != "articles" || f.score != 17 || f.of == nil || *f.of != 20 || f.folder == nil || f.folder.ID != folder {
		t.Fatalf("%d %s, %+v", w.Code, w.Body, f)
	}
	var res map[string]any
	json.Unmarshal(w.Body.Bytes(), &res) //nolint:errcheck
	rec, _ := res["record"].(map[string]any)
	if res["new_record"] != true || res["previous"] != float64(45_000) || rec["game"] != "articles" || rec["best"] != float64(17) ||
		rec["best_of"] != float64(20) || rec["plays"] != float64(3) {
		t.Errorf("body: %s", w.Body)
	}

	f = &fakeGames{}
	if w := gameRequest(gameRouter(f, true), http.MethodPost, "/games/result", `{"game":"pairs","folder_id":"none","score":30000}`); w.Code != 200 ||
		f.folder == nil || !f.folder.None || f.of != nil {
		t.Errorf("none: %d %+v", w.Code, f.folder)
	}

	for name, body := range map[string]string{
		"bad json":     `{`,
		"no game":      `{"folder_id":"all","score":30000}`,
		"no score":     `{"game":"pairs","folder_id":"all"}`,
		"score string": `{"game":"pairs","folder_id":"all","score":"fast"}`,
		"bad folder":   `{"game":"pairs","folder_id":"x","score":30000}`,
	} {
		f := &fakeGames{}
		if w := gameRequest(gameRouter(f, true), http.MethodPost, "/games/result", body); w.Code != http.StatusBadRequest || f.calls != 0 {
			t.Errorf("%s: %d, calls %d", name, w.Code, f.calls)
		}
	}

	if w := gameRequest(gameRouter(&fakeGames{err: domain.ErrValidation}, true), http.MethodPost, "/games/result",
		`{"game":"sprint","folder_id":"all","score":3}`); w.Code != http.StatusBadRequest {
		t.Errorf("invalid result: %d", w.Code)
	}
	if w := gameRequest(gameRouter(&fakeGames{err: domain.ErrNotFound}, true), http.MethodPost, "/games/result",
		`{"game":"pairs","folder_id":"`+folder.String()+`","score":30000}`); w.Code != http.StatusNotFound {
		t.Errorf("foreign folder: %d", w.Code)
	}
}
