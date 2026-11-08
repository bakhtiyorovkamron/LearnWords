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
)

type memProfile struct{ p domain.Profile }

func (m *memProfile) Profile(context.Context, uuid.UUID) (domain.Profile, error) { return m.p, nil }
func (m *memProfile) SetProfile(_ context.Context, _ uuid.UUID, name string, phone *string) error {
	m.p.FullName, m.p.Phone = &name, phone // the Telegram username stays as it was
	return nil
}

func profileRouter(m *memProfile) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(func(c *gin.Context) { c.Set(userIDKey, uuid.New()) })
	h := NewProfileHandler(m)
	r.GET("/me/profile", h.Get)
	r.PUT("/me/profile", h.Update)
	return r
}

func putProfile(r *gin.Engine, body string) *httptest.ResponseRecorder {
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPut, "/me/profile", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)
	return w
}

func TestProfile_GetEmpty(t *testing.T) {
	w := httptest.NewRecorder()
	profileRouter(&memProfile{}).ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/me/profile", nil))
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d", w.Code)
	}
	if got := w.Body.String(); got != `{"full_name":null,"phone":null,"telegram":{"connected":false,"username":null}}` {
		t.Errorf("body = %s", got)
	}
}

func TestProfile_TelegramConnected(t *testing.T) {
	u := "anna_k"
	w := httptest.NewRecorder()
	profileRouter(&memProfile{p: domain.Profile{TelegramUsername: &u, TelegramConnected: true}}).ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/me/profile", nil))
	var got struct {
		Telegram struct {
			Connected bool    `json:"connected"`
			Username  *string `json:"username"`
		} `json:"telegram"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &got)
	if !got.Telegram.Connected || got.Telegram.Username == nil || *got.Telegram.Username != "anna_k" {
		t.Errorf("telegram = %+v", got.Telegram)
	}
}

func TestProfile_Update(t *testing.T) {
	cases := []struct {
		name, body string
		status     int
		code       string
		wantPhone  string // "" = none stored
	}{
		{"name and phone are normalized", `{"full_name":"  Anna  ","phone":"+998 90 123-45-67"}`, 200, "", "+998901234567"},
		{"phone is optional", `{"full_name":"Anna"}`, 200, "", ""},
		{"an empty phone clears it", `{"full_name":"Anna","phone":""}`, 200, "", ""},
		{"name too short", `{"full_name":"A","phone":""}`, 400, "invalid_name", ""},
		{"name missing", `{"phone":"+998901234567"}`, 400, "invalid_name", ""},
		{"bad phone", `{"full_name":"Anna","phone":"+7 900 123 45 67"}`, 400, "invalid_phone", ""},
		{"bad JSON", `{`, 400, "", ""},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			m := &memProfile{}
			w := putProfile(profileRouter(m), c.body)
			if w.Code != c.status {
				t.Fatalf("status = %d, want %d (%s)", w.Code, c.status, w.Body)
			}
			var e struct{ Code string }
			_ = json.Unmarshal(w.Body.Bytes(), &e)
			if c.status == 400 {
				if e.Code != c.code {
					t.Errorf("code = %q, want %q", e.Code, c.code)
				}
				if m.p.FullName != nil {
					t.Error("a rejected request must store nothing")
				}
				return
			}
			phone := ""
			if m.p.Phone != nil {
				phone = *m.p.Phone
			}
			if phone != c.wantPhone || m.p.FullName == nil || *m.p.FullName != "Anna" {
				t.Errorf("stored name=%v phone=%q", m.p.FullName, phone)
			}
		})
	}
}
