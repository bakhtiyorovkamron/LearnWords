package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/SherClockHolmes/webpush-go"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"learnwords/internal/domain"
	"learnwords/internal/pushtest"
	"learnwords/internal/service"
)

// memPushRepo is an in-memory service.PushRepository.
type memPushRepo struct {
	mu   sync.Mutex
	subs map[string]domain.PushSubscription
	ua   map[string]string
}

func newMemPushRepo() *memPushRepo {
	return &memPushRepo{subs: map[string]domain.PushSubscription{}, ua: map[string]string{}}
}

func (m *memPushRepo) Upsert(_ context.Context, u uuid.UUID, endpoint, p, a, ua string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.subs[endpoint] = domain.PushSubscription{ID: uuid.New(), UserID: u, Endpoint: endpoint, P256dh: p, Auth: a}
	m.ua[endpoint] = ua
	return nil
}
func (m *memPushRepo) DeleteOwn(_ context.Context, u uuid.UUID, endpoint string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if s, ok := m.subs[endpoint]; ok && s.UserID == u {
		delete(m.subs, endpoint)
	}
	return nil
}
func (m *memPushRepo) DeleteEndpoint(_ context.Context, endpoint string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.subs, endpoint)
	return nil
}
func (m *memPushRepo) MarkSuccess(context.Context, string) error { return nil }
func (m *memPushRepo) All(context.Context) ([]domain.PushSubscription, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []domain.PushSubscription
	for _, s := range m.subs {
		out = append(out, s)
	}
	return out, nil
}
func (m *memPushRepo) ByUsers(ctx context.Context, ids []uuid.UUID) ([]domain.PushSubscription, error) {
	all, _ := m.All(ctx)
	var out []domain.PushSubscription
	for _, s := range all {
		for _, id := range ids {
			if s.UserID == id {
				out = append(out, s)
			}
		}
	}
	return out, nil
}
func (m *memPushRepo) Stats(ctx context.Context) (int, int, error) {
	all, _ := m.All(ctx)
	users := map[uuid.UUID]bool{}
	for _, s := range all {
		users[s.UserID] = true
	}
	return len(all), len(users), nil
}

type pushHTTPEnv struct {
	r        *gin.Engine
	repo     *memPushRepo
	srv      *httptest.Server
	mu       *sync.Mutex
	paths    *[]string
	bodies   map[string][]byte            // what each device's push service received, by path
	browsers map[string]*pushtest.Browser // by endpoint
}

// newPushHTTPEnv: the push routes behind a middleware that takes the user from X-Test-User; a TLS
// test server plays the browsers' push service. enabled=false → no VAPID keys.
func newPushHTTPEnv(t *testing.T, enabled bool) pushHTTPEnv {
	t.Helper()
	gin.SetMode(gin.TestMode)
	var mu sync.Mutex
	var paths []string
	bodies := map[string][]byte{}
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		mu.Lock()
		paths = append(paths, r.URL.Path)
		bodies[r.URL.Path] = body
		mu.Unlock()
		w.WriteHeader(http.StatusCreated)
	}))
	t.Cleanup(srv.Close)

	private, public, err := webpush.GenerateVAPIDKeys()
	if err != nil {
		t.Fatal(err)
	}
	if !enabled {
		private, public = "", ""
	}
	repo := newMemPushRepo()
	svc := service.NewPushService(repo, public, private, "mailto:t@example.com", service.WithPushHTTPClient(srv.Client()))
	h := NewPushHandler(svc)

	r := gin.New()
	r.Use(func(c *gin.Context) { c.Set(userIDKey, uuid.MustParse(c.GetHeader("X-Test-User"))) })
	r.GET("/push/public-key", h.PublicKey)
	r.POST("/push/subscribe", h.Subscribe)
	r.DELETE("/push/subscribe", h.Unsubscribe)
	r.GET("/admin/push", h.AdminStats)
	r.POST("/admin/push", h.AdminSend)
	return pushHTTPEnv{r, repo, srv, &mu, &paths, bodies, map[string]*pushtest.Browser{}}
}

func (e pushHTTPEnv) do(user uuid.UUID, method, path, body string) *httptest.ResponseRecorder {
	w := httptest.NewRecorder()
	req := httptest.NewRequest(method, path, bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "TestBrowser/1.0")
	req.Header.Set("X-Test-User", user.String())
	e.r.ServeHTTP(w, req)
	return w
}

func browserKeysJSON(t *testing.T) string {
	t.Helper()
	b, err := pushtest.NewBrowser()
	if err != nil {
		t.Fatal(err)
	}
	return `{"p256dh":"` + b.P256dh + `","auth":"` + b.Auth + `"}`
}

func (e pushHTTPEnv) subscribe(t *testing.T, user uuid.UUID, endpoint string) {
	t.Helper()
	b, err := pushtest.NewBrowser()
	if err != nil {
		t.Fatal(err)
	}
	e.browsers[endpoint] = b
	w := e.do(user, "POST", "/push/subscribe", `{"endpoint":"`+endpoint+`","keys":{"p256dh":"`+b.P256dh+`","auth":"`+b.Auth+`"}}`)
	if w.Code != 204 {
		t.Fatalf("subscribe %s: %d %s", endpoint, w.Code, w.Body)
	}
}

func TestPushAPI_SubscribeUpsertReassignAndUserAgent(t *testing.T) {
	e := newPushHTTPEnv(t, true)
	a, b := uuid.New(), uuid.New()
	ep := e.srv.URL + "/ep/1"
	e.subscribe(t, a, ep)
	e.subscribe(t, a, ep) // the same device again
	if len(e.repo.subs) != 1 || e.repo.subs[ep].UserID != a || e.repo.ua[ep] != "TestBrowser/1.0" {
		t.Fatalf("rows %d owner %v ua %q", len(e.repo.subs), e.repo.subs[ep].UserID, e.repo.ua[ep])
	}
	e.subscribe(t, b, ep) // the browser now belongs to someone else
	if len(e.repo.subs) != 1 || e.repo.subs[ep].UserID != b {
		t.Errorf("not reassigned: %d rows, owner %v", len(e.repo.subs), e.repo.subs[ep].UserID)
	}
}

func TestPushAPI_UnsubscribeOnlyOwn(t *testing.T) {
	e := newPushHTTPEnv(t, true)
	a, b := uuid.New(), uuid.New()
	ep := e.srv.URL + "/ep/1"
	e.subscribe(t, a, ep)

	if w := e.do(b, "DELETE", "/push/subscribe", `{"endpoint":"`+ep+`"}`); w.Code != 204 || len(e.repo.subs) != 1 {
		t.Errorf("another user's delete: %d, rows %d (must stay)", w.Code, len(e.repo.subs))
	}
	if w := e.do(a, "DELETE", "/push/subscribe", `{"endpoint":"`+ep+`"}`); w.Code != 204 || len(e.repo.subs) != 0 {
		t.Errorf("own delete: %d, rows %d", w.Code, len(e.repo.subs))
	}
	if w := e.do(a, "DELETE", "/push/subscribe", `{}`); w.Code != 400 {
		t.Errorf("no endpoint: %d", w.Code)
	}
}

func TestPushAPI_SubscribeValidation(t *testing.T) {
	e := newPushHTTPEnv(t, true)
	u := uuid.New()
	keys := browserKeysJSON(t)
	for name, c := range map[string]struct {
		body string
		want int
	}{
		"http endpoint":  {`{"endpoint":"http://push.example.com/x","keys":` + keys + `}`, 400},
		"no endpoint":    {`{"keys":` + keys + `}`, 400},
		"no keys":        {`{"endpoint":"https://push.example.com/x"}`, 400},
		"empty auth":     {`{"endpoint":"https://push.example.com/x","keys":{"p256dh":"abc","auth":""}}`, 400},
		"endpoint 2049":  {`{"endpoint":"https://push.example.com/` + strings.Repeat("a", 2049) + `","keys":` + keys + `}`, 400},
		"bad json":       {`{`, 400},
		"body over 8 KB": {`{"endpoint":"https://push.example.com/` + strings.Repeat("a", 9<<10) + `","keys":` + keys + `}`, 413},
	} {
		if w := e.do(u, "POST", "/push/subscribe", c.body); w.Code != c.want {
			t.Errorf("%s: %d, want %d (%s)", name, w.Code, c.want, w.Body)
		}
	}
	if len(e.repo.subs) != 0 {
		t.Errorf("invalid requests stored %d rows", len(e.repo.subs))
	}
}

func TestPushAPI_WithoutKeys_503AndNothingElseBreaks(t *testing.T) {
	e := newPushHTTPEnv(t, false)
	u := uuid.New()
	for name, w := range map[string]*httptest.ResponseRecorder{
		"public key": e.do(u, "GET", "/push/public-key", ""),
		"subscribe":  e.do(u, "POST", "/push/subscribe", `{"endpoint":"https://push.example.com/x","keys":`+browserKeysJSON(t)+`}`),
		"admin send": e.do(u, "POST", "/admin/push", `{"target":"all","title":"t","body":"b"}`),
	} {
		m := decode(t, w)
		if w.Code != 503 || m["code"] != "push_disabled" {
			t.Errorf("%s: %d %s", name, w.Code, w.Body)
		}
	}
	// leaving and the numbers still work
	if w := e.do(u, "DELETE", "/push/subscribe", `{"endpoint":"https://push.example.com/x"}`); w.Code != 204 {
		t.Errorf("unsubscribe: %d", w.Code)
	}
	if w := e.do(u, "GET", "/admin/push", ""); w.Code != 200 {
		t.Errorf("stats: %d", w.Code)
	}
}

func TestPushAPI_PublicKey(t *testing.T) {
	e := newPushHTTPEnv(t, true)
	w := e.do(uuid.New(), "GET", "/push/public-key", "")
	if m := decode(t, w); w.Code != 200 || m["key"] == "" || m["key"] == nil {
		t.Errorf("%d %s", w.Code, w.Body)
	}
}

func TestPushAPI_AdminSend_Targets(t *testing.T) {
	e := newPushHTTPEnv(t, true)
	admin, a, b, c := uuid.New(), uuid.New(), uuid.New(), uuid.New()
	e.subscribe(t, admin, e.srv.URL+"/admin1")
	e.subscribe(t, a, e.srv.URL+"/a1")
	e.subscribe(t, a, e.srv.URL+"/a2")
	e.subscribe(t, b, e.srv.URL+"/b1")
	e.subscribe(t, c, e.srv.URL+"/c1")

	w := e.do(admin, "GET", "/admin/push", "")
	if m := decode(t, w); m["devices"] != float64(5) || m["users"] != float64(4) {
		t.Errorf("stats: %s", w.Body)
	}

	reached := func() string {
		e.mu.Lock()
		defer e.mu.Unlock()
		got := strings.Join(*e.paths, " ")
		*e.paths = nil
		return got
	}
	send := func(body string) (int, map[string]any) {
		w := e.do(admin, "POST", "/admin/push", body)
		return w.Code, decode(t, w)
	}

	// "me": only the calling admin's devices
	code, m := send(`{"target":"me","title":"Hi","body":"Test"}`)
	if code != 200 || m["sent"] != float64(1) || m["users"] != float64(1) || m["failed"] != float64(0) || m["removed"] != float64(0) {
		t.Fatalf("me: %d %v", code, m)
	}
	if got := reached(); got != "/admin1" {
		t.Errorf("me reached %q", got)
	}

	// "users": exactly those users' devices; an unknown id is ignored; a repeated id counts once
	code, m = send(`{"target":"users","user_ids":["` + a.String() + `","` + c.String() + `","` + a.String() + `","` + uuid.NewString() + `"],"title":"Hi","body":"Test"}`)
	if code != 200 || m["sent"] != float64(3) || m["users"] != float64(2) {
		t.Fatalf("users: %d %v", code, m)
	}
	got := reached()
	if strings.Contains(got, "/b1") || strings.Contains(got, "/admin1") || !strings.Contains(got, "/a1") || !strings.Contains(got, "/a2") || !strings.Contains(got, "/c1") {
		t.Errorf("users reached %q", got)
	}

	// users that do not exist at all: nothing to send, still a 200
	if code, m = send(`{"target":"users","user_ids":["` + uuid.NewString() + `"],"title":"Hi","body":"Test"}`); code != 200 || m["sent"] != float64(0) || m["users"] != float64(0) {
		t.Errorf("unknown users: %d %v", code, m)
	}
	reached()

	// "all"
	if code, m = send(`{"target":"all","title":"Hi","body":"Test"}`); code != 200 || m["sent"] != float64(5) || m["users"] != float64(4) {
		t.Errorf("all: %d %v", code, m)
	}
}

func TestPushAPI_AdminSend_NoUrlFromTheClient_TheTapOpensCards(t *testing.T) {
	e := newPushHTTPEnv(t, true)
	admin := uuid.New()
	ep := e.srv.URL + "/admin1"
	e.subscribe(t, admin, ep)

	// a client that still sends a url (even an evil one) is not an error — and the url is ignored
	for _, url := range []string{`"https://evil.example/phish"`, `"/stats"`, `"//evil"`} {
		w := e.do(admin, "POST", "/admin/push", `{"target":"me","title":"Hi","body":"Test","url":`+url+`}`)
		if w.Code != 200 {
			t.Fatalf("url %s: %d %s", url, w.Code, w.Body)
		}
		raw, err := e.browsers[ep].Decrypt(e.bodies["/admin1"])
		if err != nil {
			t.Fatal(err)
		}
		var p domain.PushPayload
		if err := json.Unmarshal(raw, &p); err != nil || p != (domain.PushPayload{Title: "Hi", Body: "Test", URL: "/cards"}) {
			t.Errorf("url %s: the device received %s (%v)", url, raw, err)
		}
	}
}

func TestPushAPI_AdminSend_Validation(t *testing.T) {
	e := newPushHTTPEnv(t, true)
	admin := uuid.New()
	e.subscribe(t, admin, e.srv.URL+"/a1")
	many := make([]string, 201)
	for i := range many {
		many[i] = `"` + uuid.NewString() + `"`
	}
	ok := uuid.NewString()
	for name, c := range map[string]struct {
		body string
		want int
	}{
		"users with no ids":     {`{"target":"users","title":"t","body":"b"}`, 400},
		"users with empty list": {`{"target":"users","user_ids":[],"title":"t","body":"b"}`, 400},
		"an invalid id":         {`{"target":"users","user_ids":["` + ok + `","not-a-uuid"],"title":"t","body":"b"}`, 400},
		"201 ids":               {`{"target":"users","user_ids":[` + strings.Join(many, ",") + `],"title":"t","body":"b"}`, 400},
		"200 ids are fine":      {`{"target":"users","user_ids":[` + strings.Join(many[:200], ",") + `],"title":"t","body":"b"}`, 200},
		"title 61":              {`{"target":"all","title":"` + strings.Repeat("я", 61) + `","body":"b"}`, 400},
		"empty title":           {`{"target":"all","title":"","body":"b"}`, 400},
		"body 201":              {`{"target":"all","title":"t","body":"` + strings.Repeat("я", 201) + `"}`, 400},
		"unknown target":        {`{"target":"everyone","title":"t","body":"b"}`, 400},
		"a user id as target":   {`{"target":"` + ok + `","title":"t","body":"b"}`, 400},
		"no target":             {`{"title":"t","body":"b"}`, 400},
		"bad json":              {`{`, 400},
	} {
		if w := e.do(admin, "POST", "/admin/push", c.body); w.Code != c.want {
			t.Errorf("%s: %d, want %d (%s)", name, w.Code, c.want, w.Body)
		}
	}
}
