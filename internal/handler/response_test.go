package handler

import (
	"bytes"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

// A 500 tells the client only "internal error"; the log has the error text, path and user_id.
func TestInternalErrorIsLoggedButNotExposed(t *testing.T) {
	var logs bytes.Buffer
	old := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&logs, nil)))
	t.Cleanup(func() { slog.SetDefault(old) })

	gin.SetMode(gin.TestMode)
	uid := uuid.New()
	r := gin.New()
	r.Use(Recovery(), func(c *gin.Context) { c.Set(userIDKey, uid) })
	r.GET("/api/collection", func(c *gin.Context) {
		writeError(c, errors.New(`ERROR: column "lemma" does not exist (SQLSTATE 42703)`))
	})
	r.GET("/api/boom", func(c *gin.Context) { panic("kaboom") })

	for _, path := range []string{"/api/collection?status=all", "/api/boom"} {
		logs.Reset()
		w := httptest.NewRecorder()
		r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, path, nil))
		if w.Code != 500 || strings.TrimSpace(w.Body.String()) != `{"error":"internal error"}` {
			t.Errorf("%s: client got %d %q", path, w.Code, w.Body)
		}
		out := logs.String()
		for _, want := range []string{"level=ERROR", "path=" + strings.SplitN(path, "?", 2)[0], "user_id=" + uid.String(), "method=GET"} {
			if !strings.Contains(out, want) {
				t.Errorf("%s: log lacks %q:\n%s", path, want, out)
			}
		}
		if path == "/api/collection?status=all" && !strings.Contains(out, "SQLSTATE 42703") {
			t.Errorf("log lacks the error text:\n%s", out)
		}
	}
}
