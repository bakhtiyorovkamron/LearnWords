package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"learnwords/internal/domain"
	"learnwords/internal/service"
)

type fakeBroadcastRepo struct {
	create   func(domain.BroadcastParams) (domain.TelegramBroadcast, int, error)
	lastP    domain.BroadcastParams
	audience domain.TelegramAudience
}

func (f *fakeBroadcastRepo) Audience(context.Context) (domain.TelegramAudience, error) {
	return f.audience, nil
}
func (f *fakeBroadcastRepo) CreateBroadcast(_ context.Context, p domain.BroadcastParams) (domain.TelegramBroadcast, int, error) {
	f.lastP = p
	return f.create(p)
}
func (f *fakeBroadcastRepo) ClaimNext(context.Context) (*domain.TelegramBroadcast, error) {
	return nil, nil
}
func (f *fakeBroadcastRepo) PendingRecipients(context.Context, int64, string, int) ([]domain.BroadcastRecipient, error) {
	return nil, nil
}
func (f *fakeBroadcastRepo) SetRecipient(context.Context, int64, uuid.UUID, string) error { return nil }
func (f *fakeBroadcastRepo) MarkUserBlocked(context.Context, uuid.UUID) error             { return nil }
func (f *fakeBroadcastRepo) RefreshCounters(context.Context, int64) error                 { return nil }
func (f *fakeBroadcastRepo) Finish(context.Context, int64, string) error                  { return nil }
func (f *fakeBroadcastRepo) InterruptUnfinished(context.Context) error                    { return nil }
func (f *fakeBroadcastRepo) MarkAutoSent(context.Context, string, uuid.UUID) error        { return nil }
func (f *fakeBroadcastRepo) List(context.Context, int) ([]domain.TelegramBroadcast, error) {
	return nil, nil
}
func (f *fakeBroadcastRepo) Get(_ context.Context, id int64) (domain.TelegramBroadcast, error) {
	if id == 7 {
		return domain.TelegramBroadcast{ID: 7, Status: domain.BroadcastRunning, Total: 10, Sent: 4}, nil
	}
	return domain.TelegramBroadcast{}, domain.ErrNotFound
}

func broadcastRouter(repo *fakeBroadcastRepo, enabled bool, admin uuid.UUID) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(func(c *gin.Context) {
		id := uuid.MustParse(c.GetHeader("X-Test-User"))
		c.Set(userIDKey, id)
		role := domain.RoleUser
		if id == admin {
			role = domain.RoleAdmin
		}
		c.Set(roleKey, role)
	})
	h := NewTelegramBroadcastHandler(service.NewTelegramBroadcastService(repo, &countingBot{}, enabled))
	g := r.Group("/admin", RequireAdmin())
	g.GET("/telegram/audience", h.Audience)
	g.POST("/telegram/broadcasts", h.Create)
	g.GET("/telegram/broadcasts", h.List)
	g.GET("/telegram/broadcasts/:id", h.Get)
	return r
}

func callAs(r *gin.Engine, who uuid.UUID, method, path, body string) *httptest.ResponseRecorder {
	w := httptest.NewRecorder()
	req := httptest.NewRequest(method, path, bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Test-User", who.String())
	r.ServeHTTP(w, req)
	return w
}

func TestTelegramBroadcasts_CreateAndRead(t *testing.T) {
	admin, user := uuid.New(), uuid.New()
	repo := &fakeBroadcastRepo{audience: domain.TelegramAudience{Linked: 140, Reachable: 131, OptedOut: 6, Blocked: 3}}
	repo.create = func(p domain.BroadcastParams) (domain.TelegramBroadcast, int, error) {
		return domain.TelegramBroadcast{ID: 1, Target: p.Target, Text: p.Text, Button: p.Button, Status: domain.BroadcastQueued, Total: 2}, 1, nil
	}
	r := broadcastRouter(repo, true, admin)

	if w := callAs(r, user, "GET", "/admin/telegram/audience", ""); w.Code != 403 {
		t.Errorf("a non-admin: %d", w.Code)
	}
	if w := callAs(r, user, "POST", "/admin/telegram/broadcasts", `{"target":"all","text":{"ru":"x"}}`); w.Code != 403 {
		t.Errorf("a non-admin posting: %d", w.Code)
	}
	w := callAs(r, admin, "GET", "/admin/telegram/audience", "")
	if w.Code != 200 || w.Body.String() != `{"linked":140,"reachable":131,"opted_out":6,"blocked":3}` {
		t.Errorf("audience: %d %s", w.Code, w.Body)
	}

	u1, u2 := uuid.New(), uuid.New()
	body := fmt.Sprintf(`{"target":"users","user_ids":["%s","%s"],"text":{"ru":" Привет ","uz":"Salom","en":""},"button":{"text":"Open","url":"https://yodla.fun"}}`, u1, u2)
	w = callAs(r, admin, "POST", "/admin/telegram/broadcasts", body)
	if w.Code != 202 {
		t.Fatalf("create: %d %s", w.Code, w.Body)
	}
	var out struct {
		Broadcast struct {
			ID     int64 `json:"id"`
			Status string
			Text   struct{ RU, UZ, EN *string } `json:"text"`
			Button *domain.TelegramButton       `json:"button"`
			Total  int                          `json:"total"`
		} `json:"broadcast"`
		Skipped int `json:"skipped"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &out)
	if out.Broadcast.ID != 1 || out.Broadcast.Status != "queued" || out.Skipped != 1 || out.Broadcast.Button == nil {
		t.Errorf("response %s", w.Body)
	}
	if repo.lastP.AdminID != admin || len(repo.lastP.UserIDs) != 2 || repo.lastP.Text.RU != "Привет" || repo.lastP.Text.UZ == nil || repo.lastP.Text.EN != nil {
		t.Errorf("params %+v", repo.lastP)
	}

	if w := callAs(r, admin, "GET", "/admin/telegram/broadcasts", ""); w.Code != 200 || w.Body.String() != `{"broadcasts":[]}` {
		t.Errorf("list: %d %s", w.Code, w.Body)
	}
	if w := callAs(r, admin, "GET", "/admin/telegram/broadcasts/7", ""); w.Code != 200 || !strings.Contains(w.Body.String(), `"sent":4`) {
		t.Errorf("get: %d %s", w.Code, w.Body)
	}
	if w := callAs(r, admin, "GET", "/admin/telegram/broadcasts/8", ""); w.Code != 404 {
		t.Errorf("unknown: %d", w.Code)
	}
	if w := callAs(r, admin, "GET", "/admin/telegram/broadcasts/x", ""); w.Code != 400 {
		t.Errorf("bad id: %d", w.Code)
	}
}

func TestTelegramBroadcasts_Errors(t *testing.T) {
	admin := uuid.New()
	repo := &fakeBroadcastRepo{}
	r := broadcastRouter(repo, true, admin)
	post := func(body string) *httptest.ResponseRecorder {
		return callAs(r, admin, "POST", "/admin/telegram/broadcasts", body)
	}

	repo.create = func(domain.BroadcastParams) (domain.TelegramBroadcast, int, error) {
		return domain.TelegramBroadcast{}, 0, domain.ErrBroadcastRunning
	}
	if w := post(`{"target":"all","text":{"ru":"x"}}`); w.Code != 409 || !strings.Contains(w.Body.String(), `"broadcast_running"`) {
		t.Errorf("second all: %d %s", w.Code, w.Body)
	}
	repo.create = func(domain.BroadcastParams) (domain.TelegramBroadcast, int, error) {
		return domain.TelegramBroadcast{}, 0, domain.ErrTelegramNotLinked
	}
	if w := post(`{"target":"me","text":{"ru":"x"}}`); w.Code != 400 || !strings.Contains(w.Body.String(), `"telegram_not_linked"`) {
		t.Errorf("me without telegram: %d %s", w.Code, w.Body)
	}
	for name, body := range map[string]string{
		"no text":     `{"target":"all","text":{"ru":""}}`,
		"bad target":  `{"target":"x","text":{"ru":"x"}}`,
		"bad ids":     `{"target":"users","user_ids":["nope"],"text":{"ru":"x"}}`,
		"no ids":      `{"target":"users","user_ids":[],"text":{"ru":"x"}}`,
		"http button": `{"target":"all","text":{"ru":"x"},"button":{"text":"a","url":"http://x.co"}}`,
		"half button": `{"target":"all","text":{"ru":"x"},"button":{"text":"a","url":""}}`,
		"not json":    `x`,
	} {
		if w := post(body); w.Code != 400 {
			t.Errorf("%s: %d %s", name, w.Code, w.Body)
		}
	}
	off := broadcastRouter(repo, false, admin)
	for _, c := range [][2]string{{"GET", "/admin/telegram/audience"}, {"GET", "/admin/telegram/broadcasts"}, {"GET", "/admin/telegram/broadcasts/1"}, {"POST", "/admin/telegram/broadcasts"}} {
		w := callAs(off, admin, c[0], c[1], `{"target":"all","text":{"ru":"x"}}`)
		if w.Code != 503 || !strings.Contains(w.Body.String(), `"telegram_unavailable"`) {
			t.Errorf("%s %s without a bot: %d %s", c[0], c[1], w.Code, w.Body)
		}
	}
}

func TestTelegramNotificationsSwitch(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	h := NewTelegramHandler(service.NewTelegramService(&nopTelegramRepo{}, &countingBot{}, "yodla_bot"), "s")
	r.Use(func(c *gin.Context) { c.Set(userIDKey, uuid.New()) })
	r.PUT("/me/telegram/notifications", h.SetNotifications)
	put := func(body string) int {
		w := httptest.NewRecorder()
		req := httptest.NewRequest("PUT", "/me/telegram/notifications", bytes.NewBufferString(body))
		req.Header.Set("Content-Type", "application/json")
		r.ServeHTTP(w, req)
		return w.Code
	}
	if c := put(`{"enabled":false}`); c != 204 {
		t.Errorf("off: %d", c)
	}
	if c := put(`{"enabled":true}`); c != 204 {
		t.Errorf("on: %d", c)
	}
	if c := put(`{}`); c != 400 {
		t.Errorf("missing enabled: %d", c)
	}
	if c := put(`x`); c != 400 {
		t.Errorf("bad body: %d", c)
	}
}
