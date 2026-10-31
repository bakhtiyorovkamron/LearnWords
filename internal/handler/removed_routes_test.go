package handler

import (
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"learnwords/internal/service"
)

// The routes that had no UI caller are gone: the router answers 404 (POST /contexts itself stays).
func TestRemovedRoutesAre404(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := NewRouter(RouterDeps{
		ServiceName: "t",
		CORSOrigins: []string{"http://localhost"},
		Contexts:    NewContextHandler(service.NewContextService(nil, nil, service.Providers{})),
	})
	id := uuid.NewString()
	for _, c := range []struct{ method, path string }{
		{"GET", "/api/contexts"},
		{"GET", "/api/contexts/" + id + "/words"},
		{"DELETE", "/api/contexts/" + id},
		{"POST", "/api/word-cards/" + id + "/audio"},
		{"GET", "/api/stories/2026-10-29"},
		{"POST", "/api/translations"}, // training uses the card's own stored translation
	} {
		w := httptest.NewRecorder()
		r.ServeHTTP(w, httptest.NewRequest(c.method, c.path, nil))
		// 404 (no such route) — never 401: the auth group does not even match them.
		if w.Code != 404 {
			t.Errorf("%s %s: %d, want 404", c.method, c.path, w.Code)
		}
	}
	// Control: the routes that stay are registered (they answer 401 without a login, not 404).
	for _, c := range []struct{ method, path string }{
		{"POST", "/api/contexts"},
		{"GET", "/api/stories/today"},
		{"GET", "/api/stories/by-id/" + id},
		{"GET", "/api/word-cards"},
		{"DELETE", "/api/word-cards/" + id},
	} {
		w := httptest.NewRecorder()
		r.ServeHTTP(w, httptest.NewRequest(c.method, c.path, nil))
		if w.Code != 401 {
			t.Errorf("%s %s: %d, want 401 (route must exist)", c.method, c.path, w.Code)
		}
	}
}
