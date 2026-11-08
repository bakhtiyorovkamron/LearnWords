package handler

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"learnwords/internal/auth"
	"learnwords/internal/domain"
)

// Only TelegramStats is called; the embedded nil AdminStore panics on anything else.
type telegramStatsStore struct {
	AdminStore
	stats domain.TelegramStats
	since time.Time
}

func (s *telegramStatsStore) TelegramStats(_ context.Context, since time.Time) (domain.TelegramStats, error) {
	s.since = since
	return s.stats, nil
}

// Through the real router: no login → 401, a user → 403, the admin gets the counts; "last 7 days"
// is counted from the handler's clock.
func TestAdminTelegramStats(t *testing.T) {
	gin.SetMode(gin.TestMode)
	now := time.Date(2026, 11, 8, 12, 0, 0, 0, time.UTC)
	store := &telegramStatsStore{stats: domain.NewTelegramStats(3, 1, 1)}
	h := NewAdminHandler(store, nil, nil, nil)
	h.now = func() time.Time { return now }
	user, admin := uuid.New(), uuid.New()
	tokens := auth.NewTokenManager(strings.Repeat("k", 32), "test", time.Minute, time.Hour)
	r := NewRouter(RouterDeps{
		CORSOrigins: []string{"http://localhost"}, Tokens: tokens, Ctx: context.Background(),
		Admin:      h,
		UserStatus: activeUsers{user: domain.RoleUser, admin: domain.RoleAdmin},
	})
	get := func(who *uuid.UUID) *httptest.ResponseRecorder {
		w := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/api/admin/telegram/stats", nil)
		if who != nil {
			pair, err := tokens.IssuePair(*who)
			if err != nil {
				t.Fatal(err)
			}
			req.Header.Set("Authorization", "Bearer "+pair.AccessToken)
		}
		r.ServeHTTP(w, req)
		return w
	}

	if w := get(nil); w.Code != http.StatusUnauthorized {
		t.Errorf("without login: %d", w.Code)
	}
	if w := get(&user); w.Code != http.StatusForbidden {
		t.Errorf("as a user: %d", w.Code)
	}
	w := get(&admin)
	if w.Code != http.StatusOK || w.Body.String() != `{"total_users":3,"connected":1,"percent":33.3,"connected_last_7d":1}` {
		t.Errorf("as the admin: %d %s", w.Code, w.Body)
	}
	if want := now.AddDate(0, 0, -7); !store.since.Equal(want) {
		t.Errorf("since %v, want %v", store.since, want)
	}

	store.stats = domain.NewTelegramStats(0, 0, 0)
	if w := get(&admin); w.Body.String() != `{"total_users":0,"connected":0,"percent":0,"connected_last_7d":0}` {
		t.Errorf("no users: %s", w.Body)
	}
}
