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

type memSettings struct {
	lang, size string
	sounds     bool
}

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
func (m *memSettings) SoundsEnabled(context.Context, uuid.UUID) (bool, error) { return m.sounds, nil }
func (m *memSettings) SetSoundsEnabled(_ context.Context, _ uuid.UUID, on bool) error {
	m.sounds = on
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

func TestSettings_SoundsEnabled(t *testing.T) {
	m := &memSettings{sounds: true}
	r := settingsRouter(m)
	do := func(method, body string) map[string]any {
		t.Helper()
		w := httptest.NewRecorder()
		req := httptest.NewRequest(method, "/me/settings", bytes.NewBufferString(body))
		req.Header.Set("Content-Type", "application/json")
		r.ServeHTTP(w, req)
		if w.Code != http.StatusOK {
			t.Fatalf("%s %s: %d %s", method, body, w.Code, w.Body)
		}
		var out map[string]any
		if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
			t.Fatal(err)
		}
		return out
	}

	if got := do(http.MethodGet, "")["sounds_enabled"]; got != true {
		t.Errorf("default: %v, want true", got)
	}
	if got := do(http.MethodPut, `{"sounds_enabled":false}`)["sounds_enabled"]; got != false || m.sounds {
		t.Errorf("off: %v stored=%v", got, m.sounds)
	}
	// Changing another setting must not touch the sounds switch.
	if got := do(http.MethodPut, `{"review_session_size":"50"}`)["sounds_enabled"]; got != false {
		t.Errorf("unrelated update changed sounds: %v", got)
	}
	if got := do(http.MethodPut, `{"sounds_enabled":true}`)["sounds_enabled"]; got != true {
		t.Errorf("on: %v", got)
	}
}
