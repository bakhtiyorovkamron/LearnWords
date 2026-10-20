package handler

import (
	"bytes"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"learnwords/internal/service"
)

// The paths below never reach the repository (the answer is decided before), so a service without
// one is enough to check status codes and the body limit.
func ownStoryRouter() *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(func(c *gin.Context) { c.Set(userIDKey, uuid.New()) }, NativeLang())
	h := NewStoryHandler(service.NewStoryService(nil, nil, nil, nil))
	r.POST("/stories/own", h.CreateOwn)
	r.PUT("/stories/own/:id", h.UpdateOwn)
	r.DELETE("/stories/own/:id", h.DeleteOwn)
	r.GET("/stories/by-id/:id", h.ByID)
	return r
}

func sendJSON(r *gin.Engine, method, path, body string) *httptest.ResponseRecorder {
	w := httptest.NewRecorder()
	req := httptest.NewRequest(method, path, bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)
	return w
}

func TestOwnStoryEndpoints_RejectBadInputBeforeAnythingElse(t *testing.T) {
	r := ownStoryRouter()
	id := uuid.NewString()
	ok := `"text":"Der Hund läuft durch den Park.","translation_mode":"auto"`

	for name, c := range map[string]struct {
		method, path, body string
		want               int
	}{
		"invalid JSON":            {"POST", "/stories/own", `{`, 400},
		"empty text":              {"POST", "/stories/own", `{"text":"","translation_mode":"auto"}`, 400},
		"unknown mode":            {"POST", "/stories/own", `{"text":"Der Hund läuft durch den Park.","translation_mode":"x"}`, 400},
		"Cyrillic":                {"POST", "/stories/own", `{"text":"Это русский текст, а не немецкий.","translation_mode":"auto"}`, 400},
		"auto without AI":         {"POST", "/stories/own", `{` + ok + `}`, 503},
		"body over 64 KB":         {"POST", "/stories/own", `{"text":"` + strings.Repeat("a", 70<<10) + `","translation_mode":"auto"}`, 413},
		"update: body over 64 KB": {"PUT", "/stories/own/" + id, `{"text":"` + strings.Repeat("a", 70<<10) + `","translation_mode":"auto"}`, 413},
		"update: bad id":          {"PUT", "/stories/own/not-a-uuid", `{` + ok + `}`, 400},
		"update: bad text":        {"PUT", "/stories/own/" + id, `{"text":"kurz","translation_mode":"auto"}`, 400},
		"delete: bad id":          {"DELETE", "/stories/own/not-a-uuid", ``, 400},
		"by-id: bad id":           {"GET", "/stories/by-id/nope", ``, 400},
	} {
		if w := sendJSON(r, c.method, c.path, c.body); w.Code != c.want {
			t.Errorf("%s: %d, want %d (%s)", name, w.Code, c.want, strings.TrimSpace(w.Body.String()))
		}
	}
}
