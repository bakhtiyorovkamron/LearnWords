package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"learnwords/internal/domain"
	"learnwords/internal/service"
)

// markers reads the two read-marker fields of a messages response (both must be present).
func markers(t *testing.T, w *httptest.ResponseRecorder) (own, other int64) {
	t.Helper()
	if w.Code != 200 {
		t.Fatalf("%d %s", w.Code, w.Body)
	}
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(w.Body.Bytes(), &raw); err != nil {
		t.Fatal(err)
	}
	for _, k := range []string{"read_message_id", "other_read_message_id"} {
		if _, ok := raw[k]; !ok {
			t.Fatalf("no %q in %s", k, w.Body)
		}
	}
	_ = json.Unmarshal(raw["read_message_id"], &own)
	_ = json.Unmarshal(raw["other_read_message_id"], &other)
	return own, other
}

func TestSupport_ReadMarkersOnBothMessagesEndpoints_GETDoesNotMarkRead(t *testing.T) {
	e := newSupportEnv()
	th := e.mine(t, e.user, 0).ThreadID
	e.write(t, e.user, th, "help")         // 1: marks the user's thread read for them
	reply := e.write(t, e.admin, th, "hi") // 2: marks it read for the admins
	later := e.write(t, e.admin, th, "also")

	own, other := markers(t, e.as(e.user, "GET", "/support/messages", ""))
	if own != 1 || other != later.ID {
		t.Errorf("user: read %d other %d, want 1 and %d", own, other, later.ID)
	}
	own, other = markers(t, e.as(e.admin, "GET", fmt.Sprintf("/admin/support/threads/%d/messages", th), ""))
	if own != later.ID || other != 1 {
		t.Errorf("admin: read %d other %d, want %d and 1", own, other, later.ID)
	}
	for i := 0; i < 2; i++ { // reading again does not move the user's marker
		if own, _ := markers(t, e.as(e.user, "GET", "/support/messages", "")); own != 1 {
			t.Fatalf("GET marked the thread read: %d", own)
		}
	}

	if w := e.as(e.user, "POST", "/support/read", fmt.Sprintf(`{"up_to":%d}`, reply.ID)); w.Code != 204 {
		t.Fatalf("read: %d %s", w.Code, w.Body)
	}
	if own, _ := markers(t, e.as(e.user, "GET", "/support/messages", "")); own != reply.ID {
		t.Errorf("after read: %d", own)
	}
	e.as(e.user, "POST", "/support/read", `{"up_to":1}`) // never backwards
	if own, _ := markers(t, e.as(e.user, "GET", "/support/messages", "")); own != reply.ID {
		t.Errorf("moved back: %d", own)
	}
	if w := e.as(e.user, "POST", "/support/read", `{"up_to":-1}`); w.Code != 400 {
		t.Errorf("negative up_to: %d", w.Code)
	}
	if w := e.as(e.user, "POST", "/support/read", `nope`); w.Code != 400 {
		t.Errorf("bad body: %d", w.Code)
	}
}

func TestPurchase_ReadMarkersOnBothMessagesEndpoints_BuyerReadEndpoint(t *testing.T) {
	e := newPurchaseEnv(cardAndTelegram)
	id := e.buy(t, e.user, "photo_35")
	e.say(t, e.user, id, "paid")         // 1
	reply := e.say(t, e.admin, id, "ok") // 2

	own, other := markers(t, e.as(e.user, "GET", e.chatPath(e.user, id), ""))
	if own != 1 || other != reply.ID {
		t.Errorf("buyer: read %d other %d", own, other)
	}
	own, other = markers(t, e.as(e.admin, "GET", e.chatPath(e.admin, id), ""))
	if own != reply.ID || other != 1 {
		t.Errorf("admin: read %d other %d", own, other)
	}
	markers(t, e.as(e.user, "GET", e.chatPath(e.user, id), ""))
	if own, _ := markers(t, e.as(e.user, "GET", e.chatPath(e.user, id), "")); own != 1 {
		t.Errorf("GET marked the chat read: %d", own)
	}

	path := "/me/purchases/" + id + "/read"
	if w := e.as(e.other, "POST", path, `{"up_to":2}`); w.Code != 404 {
		t.Errorf("someone else's request: %d, want 404", w.Code)
	}
	if own, _ := markers(t, e.as(e.user, "GET", e.chatPath(e.user, id), "")); own != 1 {
		t.Errorf("the stranger moved the marker: %d", own)
	}
	if w := e.as(e.user, "POST", path, fmt.Sprintf(`{"up_to":%d}`, reply.ID)); w.Code != 204 {
		t.Fatalf("read: %d %s", w.Code, w.Body)
	}
	if own, _ := markers(t, e.as(e.user, "GET", e.chatPath(e.user, id), "")); own != reply.ID {
		t.Errorf("after read: %d", own)
	}
	if w := e.as(e.user, "POST", "/me/purchases/"+uuid.NewString()+"/read", `{"up_to":1}`); w.Code != 404 {
		t.Errorf("unknown request: %d", w.Code)
	}
	// A request without any thread: nothing to mark, still 204 for its owner.
	quiet := e.buy(t, e.user, "photo_35")
	if w := e.as(e.user, "POST", "/me/purchases/"+quiet+"/read", `{"up_to":5}`); w.Code != 204 {
		t.Errorf("no thread: %d", w.Code)
	}
}

type fakeUnread struct {
	user  domain.UserChatUnread
	admin domain.AdminChatUnread
}

func (f fakeUnread) ForUser(context.Context, uuid.UUID) (domain.UserChatUnread, error) {
	return f.user, nil
}
func (f fakeUnread) ForAdmins(context.Context) (domain.AdminChatUnread, error) { return f.admin, nil }

func TestChatUnreadEndpoints(t *testing.T) {
	gin.SetMode(gin.TestMode)
	admin, user, pid := uuid.New(), uuid.New(), uuid.New()
	h := NewChatUnreadHandler(service.NewChatUnreadService(fakeUnread{
		user:  domain.UserChatUnread{Support: 2, Purchases: []domain.PurchaseChatUnread{{ID: pid, Code: "YD-4821", Unread: 1}}},
		admin: domain.AdminChatUnread{Support: 4, Purchases: 1},
	}))
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
	r.GET("/me/chats/unread", h.Mine)
	r.GET("/admin/chats/unread", RequireAdmin(), h.Admin)
	get := func(who uuid.UUID, path string) *httptest.ResponseRecorder {
		w := httptest.NewRecorder()
		req := httptest.NewRequest("GET", path, nil)
		req.Header.Set("X-Test-User", who.String())
		r.ServeHTTP(w, req)
		return w
	}

	w := get(user, "/me/chats/unread")
	want := fmt.Sprintf(`{"purchases":[{"id":%q,"code":"YD-4821","unread":1}],"support":2,"total":3}`, pid)
	if w.Code != 200 || w.Body.String() != want {
		t.Errorf("mine: %d %s", w.Code, w.Body)
	}
	if w := get(admin, "/admin/chats/unread"); w.Code != 200 || w.Body.String() != `{"purchases":1,"support":4,"total":5}` {
		t.Errorf("admin: %d %s", w.Code, w.Body)
	}
	if w := get(user, "/admin/chats/unread"); w.Code != 403 {
		t.Errorf("a user on the admin endpoint: %d", w.Code)
	}
	empty := NewChatUnreadHandler(service.NewChatUnreadService(fakeUnread{}))
	r2 := gin.New()
	r2.Use(func(c *gin.Context) { c.Set(userIDKey, user) })
	r2.GET("/u", empty.Mine)
	w = httptest.NewRecorder()
	r2.ServeHTTP(w, httptest.NewRequest("GET", "/u", nil))
	if w.Body.String() != `{"purchases":[],"support":0,"total":0}` {
		t.Errorf("empty: %s", w.Body)
	}
}
