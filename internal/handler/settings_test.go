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
)

type memSettings struct{ lang, size string }

func (m *memSettings) InterfaceLanguage(context.Context, uuid.UUID) (string, error) {
	return m.lang, nil
}
func (m *memSettings) SetInterfaceLanguage(_ context.Context, _ uuid.UUID, l string) error {
	m.lang = l
	return nil
}
func (m *memSettings) ReviewSessionSize(context.Context, uuid.UUID) (string, error) {
	return m.size, nil
}
func (m *memSettings) SetReviewSessionSize(_ context.Context, _ uuid.UUID, s string) error {
	m.size = s
	return nil
}
func settingsRouter(m *memSettings) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(func(c *gin.Context) { c.Set(userIDKey, uuid.New()) })
	h := NewSettingsHandler(m)
	r.GET("/me/settings", h.Get)
	r.PUT("/me/settings", h.Update)
	return r
}

func TestSettings_NoSoundFields_AndOldClientsStillGet200(t *testing.T) {
	m := &memSettings{lang: "ru", size: "20"}
	r := settingsRouter(m)
	do := func(method, body string) (int, map[string]any) {
		t.Helper()
		w := httptest.NewRecorder()
		req := httptest.NewRequest(method, "/me/settings", bytes.NewBufferString(body))
		req.Header.Set("Content-Type", "application/json")
		r.ServeHTTP(w, req)
		var out map[string]any
		_ = json.Unmarshal(w.Body.Bytes(), &out)
		return w.Code, out
	}

	code, out := do(http.MethodGet, "")
	if code != 200 || out["interface_language"] != "ru" || out["review_session_size"] != "20" {
		t.Fatalf("GET: %d %v", code, out)
	}
	for _, gone := range []string{"sounds_enabled", "ui_sounds_enabled"} {
		if _, ok := out[gone]; ok {
			t.Errorf("GET still has %s", gone)
		}
	}

	// An old client that still sends the sound switches (alone, or with a real setting): 200, ignored.
	for _, body := range []string{
		`{"sounds_enabled":false}`,
		`{"ui_sounds_enabled":false}`,
		`{"sounds_enabled":false,"ui_sounds_enabled":false,"review_session_size":"50"}`,
	} {
		code, out := do(http.MethodPut, body)
		if code != 200 {
			t.Errorf("PUT %s: %d", body, code)
		}
		for _, gone := range []string{"sounds_enabled", "ui_sounds_enabled"} {
			if _, ok := out[gone]; ok {
				t.Errorf("PUT %s: response has %s", body, gone)
			}
		}
	}
	if m.size != "50" || m.lang != "ru" {
		t.Errorf("real settings: lang %q size %q", m.lang, m.size)
	}
	if code, _ := do(http.MethodPut, `{}`); code != http.StatusBadRequest {
		t.Errorf("an empty update is still a 400: %d", code)
	}
}
