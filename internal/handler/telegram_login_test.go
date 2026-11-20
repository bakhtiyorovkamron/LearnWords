package handler

import (
	"context"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"learnwords/internal/domain"
	"learnwords/internal/service"
)

type fakeTelegramLogin struct {
	ua      string
	secrets []string
	poll    domain.TelegramLoginPoll
}

func (f *fakeTelegramLogin) Start(_ context.Context, ua string) (domain.TelegramLoginStart, error) {
	f.ua = ua
	return domain.TelegramLoginStart{URL: "https://t.me/yodlafun_bot?start=login_x", Secret: "s3cret",
		ExpiresAt: time.Date(2026, 11, 21, 9, 35, 0, 0, time.UTC)}, nil
}

func (f *fakeTelegramLogin) Poll(_ context.Context, secret string) (domain.TelegramLoginPoll, error) {
	f.secrets = append(f.secrets, secret)
	return f.poll, nil
}

func telegramLoginRouter(tg TelegramLogin) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	h := NewAuthHandler(nil, true)
	if tg != nil {
		h.WithTelegramLogin(tg)
	}
	r.POST("/api/auth/telegram", h.TelegramStart)
	r.POST("/api/auth/telegram/poll", h.TelegramPoll)
	return r
}

func TestTelegramLoginEndpoints_503WithoutTheBot(t *testing.T) {
	r := telegramLoginRouter(nil)
	for _, path := range []string{"/api/auth/telegram", "/api/auth/telegram/poll"} {
		w := sendJSON(r, http.MethodPost, path, `{"secret":"x"}`)
		if w.Code != http.StatusServiceUnavailable || decode(t, w)["code"] != "telegram_unavailable" {
			t.Errorf("%s: %d %s", path, w.Code, w.Body)
		}
	}
	// The real service without a bot answers the same.
	svc := service.NewTelegramLoginService(nil, nil, "", nil, nil)
	if w := sendJSON(telegramLoginRouter(svc), http.MethodPost, "/api/auth/telegram", ``); w.Code != http.StatusServiceUnavailable {
		t.Errorf("service without a bot: %d %s", w.Code, w.Body)
	}
}

func TestTelegramLoginStart_ReturnsTheLinkAndTheSecret(t *testing.T) {
	tg := &fakeTelegramLogin{}
	r := telegramLoginRouter(tg)
	req := `{}`
	w := sendJSON(r, http.MethodPost, "/api/auth/telegram", req)
	if w.Code != http.StatusOK {
		t.Fatalf("%d %s", w.Code, w.Body)
	}
	body := decode(t, w)
	if body["url"] != "https://t.me/yodlafun_bot?start=login_x" || body["secret"] != "s3cret" || body["expires_at"] != "2026-11-21T09:35:00Z" {
		t.Errorf("body %v", body)
	}
	if w.Header().Get("Cache-Control") != "no-store" || w.Header().Get("Set-Cookie") != "" {
		t.Errorf("headers %v", w.Header())
	}
}

func TestTelegramLoginPoll_PendingHasNoSession(t *testing.T) {
	for _, status := range []string{domain.PollPending, domain.PollDenied, domain.PollExpired} {
		tg := &fakeTelegramLogin{poll: domain.TelegramLoginPoll{Status: status}}
		w := sendJSON(telegramLoginRouter(tg), http.MethodPost, "/api/auth/telegram/poll", `{"secret":"abc"}`)
		if w.Code != http.StatusOK || strings.TrimSpace(w.Body.String()) != `{"status":"`+status+`"}` {
			t.Errorf("%s: %d %s", status, w.Code, w.Body)
		}
		if w.Header().Get("Set-Cookie") != "" {
			t.Errorf("%s: a cookie was set", status)
		}
		if len(tg.secrets) != 1 || tg.secrets[0] != "abc" {
			t.Errorf("polled with %v", tg.secrets)
		}
	}
}

func TestTelegramLoginPoll_OKSetsTheRefreshCookieLikeLogin(t *testing.T) {
	exp := time.Date(2026, 11, 21, 9, 45, 0, 0, time.UTC)
	tg := &fakeTelegramLogin{poll: domain.TelegramLoginPoll{Status: domain.PollOK, NewUser: true, Tokens: domain.TokenPair{
		AccessToken: "acc", RefreshToken: "ref", AccessExpiresAt: exp, RefreshExpiresAt: exp.Add(30 * 24 * time.Hour)}}}
	w := sendJSON(telegramLoginRouter(tg), http.MethodPost, "/api/auth/telegram/poll", `{"secret":"abc"}`)
	if w.Code != http.StatusOK {
		t.Fatalf("%d %s", w.Code, w.Body)
	}
	body := decode(t, w)
	if body["status"] != "ok" || body["access_token"] != "acc" || body["new_user"] != true || body["access_expires_at"] != "2026-11-21T09:45:00Z" {
		t.Errorf("body %v", body)
	}
	if _, leaked := body["refresh_token"]; leaked {
		t.Error("the refresh token is in the body")
	}
	cookie := w.Header().Get("Set-Cookie")
	for _, want := range []string{"lw_refresh=ref", "Path=/api/auth", "HttpOnly", "Secure", "SameSite=Lax"} {
		if !strings.Contains(cookie, want) {
			t.Errorf("cookie %q has no %q", cookie, want)
		}
	}
}

func TestTelegramLoginPoll_NeedsASecret(t *testing.T) {
	tg := &fakeTelegramLogin{}
	for _, body := range []string{`{}`, `{"secret":""}`, `not json`} {
		if w := sendJSON(telegramLoginRouter(tg), http.MethodPost, "/api/auth/telegram/poll", body); w.Code != http.StatusBadRequest {
			t.Errorf("%s: %d", body, w.Code)
		}
	}
	if len(tg.secrets) != 0 {
		t.Error("polled without a secret")
	}
}

type memFirstLanguage struct{ needs map[uuid.UUID]bool }

func (m *memFirstLanguage) SetFirstLearningLanguage(_ context.Context, id uuid.UUID, _ string) (bool, error) {
	if !m.needs[id] {
		return false, nil
	}
	m.needs[id] = false
	return true, nil
}

func TestLearningLanguage_409AfterTheFirstChoice(t *testing.T) {
	gin.SetMode(gin.TestMode)
	user := uuid.New()
	h := NewWelcomeHandler(service.NewLearningLanguageService(&memFirstLanguage{needs: map[uuid.UUID]bool{user: true}}, nil))
	r := gin.New()
	r.Use(func(c *gin.Context) { c.Set(userIDKey, user) })
	r.PUT("/me/learning-language", h.SetLearningLanguage)

	if w := sendJSON(r, http.MethodPut, "/me/learning-language", `{"learning_language":"xx"}`); w.Code != http.StatusBadRequest {
		t.Errorf("unknown language: %d %s", w.Code, w.Body)
	}
	if w := sendJSON(r, http.MethodPut, "/me/learning-language", `{"learning_language":"fr"}`); w.Code != http.StatusNoContent {
		t.Fatalf("first choice: %d %s", w.Code, w.Body)
	}
	w := sendJSON(r, http.MethodPut, "/me/learning-language", `{"learning_language":"ko"}`)
	if w.Code != http.StatusConflict || decode(t, w)["code"] != "language_chosen" {
		t.Errorf("second choice: %d %s", w.Code, w.Body)
	}
}

type needsLanguageUsers struct{ id uuid.UUID }

func (u needsLanguageUsers) GetByID(_ context.Context, id uuid.UUID) (*domain.User, error) {
	return &domain.User{ID: id, Email: "tg1@telegram.yodla.fun", Role: domain.RoleUser, LearningLanguage: "de", NeedsLanguage: true}, nil
}

func TestMe_SaysNeedsLanguage(t *testing.T) {
	gin.SetMode(gin.TestMode)
	user := uuid.New()
	mem := &memFeatures{ov: map[string]domain.FeatureOverride{}}
	admin := NewAdminHandler(nil, needsLanguageUsers{user}, service.NewFeatureService(mem), newMemFeedback())
	r := gin.New()
	r.Use(func(c *gin.Context) { c.Set(userIDKey, user) })
	r.GET("/me", admin.Me)
	w := sendJSON(r, http.MethodGet, "/me", ``)
	if w.Code != http.StatusOK || decode(t, w)["needs_language"] != true {
		t.Errorf("%d %s", w.Code, w.Body)
	}
	// An ordinary account says false.
	e := newFeatureEnv()
	if w := sendJSON(e.r, http.MethodGet, "/me", ``); decode(t, w)["needs_language"] != false {
		t.Errorf("ordinary account: %s", w.Body)
	}
}
