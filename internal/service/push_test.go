package service

import (
	"context"
	"crypto/ecdh"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/SherClockHolmes/webpush-go"
	"github.com/google/uuid"

	"learnwords/internal/domain"
)

// --- fakes ---------------------------------------------------------------------------------

type memPush struct {
	mu      sync.Mutex
	subs    map[string]domain.PushSubscription // by endpoint
	deleted []string
	success []string
	agent   map[string]string
}

func newMemPush() *memPush {
	return &memPush{subs: map[string]domain.PushSubscription{}, agent: map[string]string{}}
}

func (m *memPush) Upsert(_ context.Context, userID uuid.UUID, endpoint, p256dh, auth, ua string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	s := m.subs[endpoint]
	if s.ID == uuid.Nil {
		s.ID = uuid.New()
	}
	m.subs[endpoint] = domain.PushSubscription{ID: s.ID, UserID: userID, Endpoint: endpoint, P256dh: p256dh, Auth: auth}
	m.agent[endpoint] = ua
	return nil
}
func (m *memPush) DeleteOwn(_ context.Context, userID uuid.UUID, endpoint string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if s, ok := m.subs[endpoint]; ok && s.UserID == userID {
		delete(m.subs, endpoint)
	}
	return nil
}
func (m *memPush) DeleteEndpoint(_ context.Context, endpoint string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.subs, endpoint)
	m.deleted = append(m.deleted, endpoint)
	return nil
}
func (m *memPush) MarkSuccess(_ context.Context, endpoint string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.success = append(m.success, endpoint)
	return nil
}
func (m *memPush) All(context.Context) ([]domain.PushSubscription, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []domain.PushSubscription
	for _, s := range m.subs {
		out = append(out, s)
	}
	return out, nil
}
func (m *memPush) ByUser(_ context.Context, id uuid.UUID) ([]domain.PushSubscription, error) {
	all, _ := m.All(context.Background())
	var out []domain.PushSubscription
	for _, s := range all {
		if s.UserID == id {
			out = append(out, s)
		}
	}
	return out, nil
}
func (m *memPush) Stats(ctx context.Context) (int, int, error) {
	all, _ := m.All(ctx)
	users := map[uuid.UUID]bool{}
	for _, s := range all {
		users[s.UserID] = true
	}
	return len(all), len(users), nil
}

// browserKeys makes a valid subscription key pair, like PushSubscription.getKey() would.
func browserKeys(t *testing.T) (p256dh, auth string) {
	t.Helper()
	k, err := ecdh.P256().GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	a := make([]byte, 16)
	_, _ = rand.Read(a)
	return base64.RawURLEncoding.EncodeToString(k.PublicKey().Bytes()), base64.RawURLEncoding.EncodeToString(a)
}

type pushEnv struct {
	svc  *PushService
	repo *memPush
	srv  *httptest.Server
	hits *hitLog
}

type hitLog struct {
	mu      sync.Mutex
	paths   []string
	headers http.Header // of the last request
}

func (h *hitLog) add(r *http.Request) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.paths = append(h.paths, r.URL.Path)
	h.headers = r.Header.Clone()
}

// newPushEnv: a push service (TLS test server) that answers per path: /ok 201, /gone 410,
// /missing 404, anything else 500.
func newPushEnv(t *testing.T, handler http.HandlerFunc) pushEnv {
	t.Helper()
	hits := &hitLog{}
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.add(r)
		if handler != nil {
			handler(w, r)
			return
		}
		switch {
		case strings.HasPrefix(r.URL.Path, "/ok"):
			w.WriteHeader(http.StatusCreated)
		case strings.HasPrefix(r.URL.Path, "/gone"):
			w.WriteHeader(http.StatusGone)
		case strings.HasPrefix(r.URL.Path, "/missing"):
			w.WriteHeader(http.StatusNotFound)
		default:
			w.WriteHeader(http.StatusInternalServerError)
		}
	}))
	t.Cleanup(srv.Close)
	private, public, err := webpush.GenerateVAPIDKeys()
	if err != nil {
		t.Fatal(err)
	}
	repo := newMemPush()
	svc := NewPushService(repo, public, private, "mailto:test@example.com", WithPushHTTPClient(srv.Client()))
	return pushEnv{svc, repo, srv, hits}
}

func (e pushEnv) device(t *testing.T, user uuid.UUID, path string) domain.PushSubscription {
	t.Helper()
	p, a := browserKeys(t)
	endpoint := e.srv.URL + path
	if err := e.svc.Subscribe(context.Background(), user, endpoint, p, a, "UA"); err != nil {
		t.Fatal(err)
	}
	return e.repo.subs[endpoint]
}

var payload = domain.PushPayload{Title: "Time to learn", Body: "Your words are waiting", URL: "/cards"}

// --- the sender ----------------------------------------------------------------------------

func TestPush_Send_RemovesGone_CountsFailures_StampsSuccess(t *testing.T) {
	e := newPushEnv(t, nil)
	u := uuid.New()
	e.device(t, u, "/ok/1")
	e.device(t, u, "/gone/1")
	e.device(t, u, "/missing/1")
	e.device(t, u, "/busy/1")
	subs, _ := e.repo.All(context.Background())

	res := e.svc.Send(context.Background(), subs, payload)
	if res != (domain.PushResult{Sent: 1, Failed: 1, Removed: 2}) {
		t.Fatalf("result %+v", res)
	}
	if len(e.repo.success) != 1 || !strings.HasSuffix(e.repo.success[0], "/ok/1") {
		t.Errorf("last_success_at stamped for %v", e.repo.success)
	}
	removed := strings.Join(e.repo.deleted, " ")
	if len(e.repo.deleted) != 2 || !strings.Contains(removed, "/gone/1") || !strings.Contains(removed, "/missing/1") {
		t.Errorf("deleted %v (404 and 410 are gone devices)", e.repo.deleted)
	}
	if _, kept := e.repo.subs[e.srv.URL+"/busy/1"]; !kept {
		t.Error("a 500 must NOT delete the subscription")
	}
	if len(e.repo.subs) != 2 {
		t.Errorf("left: %d, want the ok and the busy one", len(e.repo.subs))
	}
}

func TestPush_Send_RequestShape(t *testing.T) {
	e := newPushEnv(t, nil)
	e.device(t, uuid.New(), "/ok/1")
	subs, _ := e.repo.All(context.Background())
	e.svc.Send(context.Background(), subs, payload)

	h := e.hits.headers
	if h.Get("TTL") != "86400" || h.Get("Urgency") != "normal" || h.Get("Content-Encoding") != "aes128gcm" {
		t.Errorf("headers: TTL=%q Urgency=%q Content-Encoding=%q", h.Get("TTL"), h.Get("Urgency"), h.Get("Content-Encoding"))
	}
	if !strings.HasPrefix(h.Get("Authorization"), "vapid ") {
		t.Errorf("no VAPID authorization: %q", h.Get("Authorization"))
	}
}

func TestPush_Send_UnreachableServerIsAFailureNotARemoval(t *testing.T) {
	e := newPushEnv(t, nil)
	u := uuid.New()
	e.device(t, u, "/ok/1")
	e.srv.Close() // the push service is down
	subs, _ := e.repo.All(context.Background())
	res := e.svc.Send(context.Background(), subs, payload)
	if res != (domain.PushResult{Failed: 1}) || len(e.repo.deleted) != 0 || len(e.repo.subs) != 1 {
		t.Errorf("%+v deleted %v", res, e.repo.deleted)
	}
}

func TestPush_Send_AtMostEightAtATime(t *testing.T) {
	var inFlight, peak atomic.Int32
	e := newPushEnv(t, func(w http.ResponseWriter, r *http.Request) {
		n := inFlight.Add(1)
		for {
			p := peak.Load()
			if n <= p || peak.CompareAndSwap(p, n) {
				break
			}
		}
		time.Sleep(40 * time.Millisecond)
		inFlight.Add(-1)
		w.WriteHeader(http.StatusCreated)
	})
	u := uuid.New()
	for i := 0; i < 30; i++ {
		e.device(t, u, "/ok/"+uuid.NewString())
	}
	subs, _ := e.repo.All(context.Background())
	res := e.svc.Send(context.Background(), subs, payload)
	if res.Sent != 30 {
		t.Fatalf("%+v", res)
	}
	if p := peak.Load(); p > 8 || p < 2 {
		t.Errorf("peak concurrency %d, want 2..8", p)
	}
}

func TestPush_SendTo_OnlyThatUsersDevices(t *testing.T) {
	e := newPushEnv(t, nil)
	a, b := uuid.New(), uuid.New()
	e.device(t, a, "/ok/a1")
	e.device(t, a, "/ok/a2")
	e.device(t, b, "/ok/b1")

	res, err := e.svc.SendTo(context.Background(), a.String(), "Hi", "Test", "")
	if err != nil || res.Sent != 2 {
		t.Fatalf("%+v %v", res, err)
	}
	for _, p := range e.hits.paths {
		if p == "/ok/b1" {
			t.Error("another user's device was reached")
		}
	}
	e.hits.paths = nil
	if res, _ := e.svc.SendTo(context.Background(), "all", "Hi", "Test", "/stats"); res.Sent != 3 {
		t.Errorf("all: %+v", res)
	}
	if res, err := e.svc.SendTo(context.Background(), uuid.NewString(), "Hi", "Test", ""); err != nil || res != (domain.PushResult{}) {
		t.Errorf("a user without devices: %+v %v", res, err)
	}
	if _, err := e.svc.SendTo(context.Background(), "everyone", "Hi", "Test", ""); !errors.Is(err, domain.ErrValidation) {
		t.Errorf("bad target: %v", err)
	}
	if _, err := e.svc.SendTo(context.Background(), "all", strings.Repeat("x", 61), "Test", ""); !errors.Is(err, domain.ErrValidation) {
		t.Errorf("long title: %v", err)
	}
}

// --- subscribing ---------------------------------------------------------------------------

func TestPush_Subscribe_Validation_Upsert_Reassign(t *testing.T) {
	e := newPushEnv(t, nil)
	ctx, a, b := context.Background(), uuid.New(), uuid.New()
	p, au := browserKeys(t)
	ok := "https://push.example.com/send/abc"

	for name, in := range map[string][3]string{
		"http endpoint": {"http://push.example.com/x", p, au},
		"no host":       {"https:///x", p, au},
		"not a URL":     {"::::", p, au},
		"endpoint 2049": {"https://push.example.com/" + strings.Repeat("a", 2049-len("https://push.example.com/")), p, au},
		"no p256dh":     {ok, "", au},
		"no auth":       {ok, p, ""},
		"giant key":     {ok, strings.Repeat("a", 300), au},
	} {
		if err := e.svc.Subscribe(ctx, a, in[0], in[1], in[2], "UA"); !errors.Is(err, domain.ErrValidation) {
			t.Errorf("%s: %v", name, err)
		}
	}
	if n := len(e.repo.subs); n != 0 {
		t.Fatalf("invalid input stored %d rows", n)
	}

	long := strings.Repeat("U", 500)
	if err := e.svc.Subscribe(ctx, a, ok, p, au, "  "+long+"  "); err != nil {
		t.Fatal(err)
	}
	if got := e.repo.agent[ok]; len(got) != 200 {
		t.Errorf("user agent kept %d characters, want 200", len(got))
	}
	// the same endpoint again: still one row (upsert); moving to another user reassigns it
	if err := e.svc.Subscribe(ctx, b, ok, p, au, "UA2"); err != nil {
		t.Fatal(err)
	}
	if len(e.repo.subs) != 1 || e.repo.subs[ok].UserID != b {
		t.Errorf("rows %d, owner %v", len(e.repo.subs), e.repo.subs[ok].UserID)
	}
}

func TestPush_Unsubscribe_OnlyOwn(t *testing.T) {
	e := newPushEnv(t, nil)
	ctx, a, b := context.Background(), uuid.New(), uuid.New()
	d := e.device(t, a, "/ok/1")
	if err := e.svc.Unsubscribe(ctx, b, d.Endpoint); err != nil || len(e.repo.subs) != 1 {
		t.Errorf("someone else's endpoint must stay: %v, rows %d", err, len(e.repo.subs))
	}
	if err := e.svc.Unsubscribe(ctx, a, d.Endpoint); err != nil || len(e.repo.subs) != 0 {
		t.Errorf("own endpoint: %v, rows %d", err, len(e.repo.subs))
	}
	if err := e.svc.Unsubscribe(ctx, a, "  "); !errors.Is(err, domain.ErrValidation) {
		t.Errorf("empty endpoint: %v", err)
	}
}

func TestPush_WithoutKeysItIsOff(t *testing.T) {
	repo := newMemPush()
	ctx := context.Background()
	for _, svc := range []*PushService{
		NewPushService(repo, "", "", "mailto:x@y.z"),
		NewPushService(repo, "pub", "", "mailto:x@y.z"),
		NewPushService(repo, "", "priv", "mailto:x@y.z"),
	} {
		if svc.Enabled() {
			t.Error("enabled without both keys")
		}
		if _, err := svc.PublicKey(); !errors.Is(err, domain.ErrPushDisabled) {
			t.Errorf("PublicKey: %v", err)
		}
		if err := svc.Subscribe(ctx, uuid.New(), "https://push.example.com/x", "p", "a", ""); !errors.Is(err, domain.ErrPushDisabled) {
			t.Errorf("Subscribe: %v", err)
		}
		if _, err := svc.SendTo(ctx, "all", "t", "b", ""); !errors.Is(err, domain.ErrPushDisabled) {
			t.Errorf("SendTo: %v", err)
		}
		// leaving and the numbers keep working
		if err := svc.Unsubscribe(ctx, uuid.New(), "https://push.example.com/x"); err != nil {
			t.Errorf("Unsubscribe: %v", err)
		}
		if _, _, err := svc.Stats(ctx); err != nil {
			t.Errorf("Stats: %v", err)
		}
	}
}
