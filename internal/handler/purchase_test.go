package handler

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"net/http/httptest"
	"regexp"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"learnwords/internal/auth"
	"learnwords/internal/domain"
	"learnwords/internal/service"
)

// testCard is an obviously fake card number: real ones are server env only, never in the repo.
const testCard = "0000 0000 0000 0000"

// The ways to pay a server can have: a card and Telegram, one of them, or none (buying off).
var (
	cardAndTelegram = domain.PaymentInfo{CardNumber: testCard, CardHolder: "TEST HOLDER", Telegram: "yodla_help"}
	cardOnly        = domain.PaymentInfo{CardNumber: testCard, CardHolder: "TEST HOLDER"}
	telegramOnly    = domain.PaymentInfo{Telegram: "yodla_pay"}
	noPayment       = domain.PaymentInfo{}
)

// memPurchases is an in-memory service.PurchaseRepository; approvals credit feats. Its chat follows
// the postgres rules: decisions write a system line, a closed request refuses messages, hidden
// messages are filtered by the viewer's side, an admin's message marks the chat read.
type memPurchases struct {
	mu      sync.Mutex
	feats   *memFeatures
	admins  []uuid.UUID
	reqs    []*domain.PurchaseRequest // in creation order
	msgs    []domain.ChatMessage      // in id order
	threads map[uuid.UUID]int64       // request → its chat thread (made with the first message)
	images  map[string]domain.ChatImage
	read    map[uuid.UUID]int64 // request → the newest message an admin has read
	uread   map[uuid.UUID]int64 // request → the newest message the buyer has read
}

func (m *memPurchases) Create(_ context.Context, u uuid.UUID, pack domain.Pack, maxPending int) (domain.PurchaseRequest, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	pending := 0
	for _, p := range m.reqs {
		if p.UserID == u && p.Status == domain.PurchasePending {
			pending++
		}
	}
	if pending >= maxPending {
		return domain.PurchaseRequest{}, domain.ErrTooManyPending
	}
	n := len(m.reqs) + 1
	p := &domain.PurchaseRequest{ID: uuid.New(), UserID: u, Code: fmt.Sprintf("YD-%04d", n), PackID: pack.ID,
		Feature: pack.Feature, Amount: pack.Amount, PriceUZS: pack.PriceUZS, Status: domain.PurchasePending,
		CreatedAt: time.Date(2026, 11, 8, 10, 0, n, 0, time.UTC)}
	m.reqs = append(m.reqs, p)
	return *p, nil
}

func (m *memPurchases) newestFirst(keep func(*domain.PurchaseRequest) bool, limit int) []domain.PurchaseRequest {
	var out []domain.PurchaseRequest
	for i := len(m.reqs) - 1; i >= 0 && len(out) < limit; i-- {
		if keep(m.reqs[i]) {
			p := *m.reqs[i]
			p.UserEmail, p.Unread = p.UserID.String()[:8]+"@test", m.unread(p.ID)
			out = append(out, p)
		}
	}
	return out
}

func (m *memPurchases) ListByUser(_ context.Context, u uuid.UUID, limit int) ([]domain.PurchaseRequest, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := m.newestFirst(func(p *domain.PurchaseRequest) bool { return p.UserID == u }, limit)
	for i := range out {
		out[i].UserEmail = ""
	}
	return out, nil
}

func (m *memPurchases) ListByStatus(_ context.Context, status string, limit int) ([]domain.PurchaseRequest, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.newestFirst(func(p *domain.PurchaseRequest) bool { return status == "" || p.Status == status }, limit), nil
}

func (m *memPurchases) find(id uuid.UUID) *domain.PurchaseRequest {
	for _, p := range m.reqs {
		if p.ID == id {
			return p
		}
	}
	return nil
}

func (m *memPurchases) Cancel(_ context.Context, u, id uuid.UUID) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	p := m.find(id)
	if p == nil || p.UserID != u || p.Status != domain.PurchasePending {
		return domain.ErrPurchaseNotFound
	}
	now := time.Now()
	p.Status, p.DecidedAt = domain.PurchaseCancelled, &now
	m.system(*p)
	return nil
}

func (m *memPurchases) decide(id, admin uuid.UUID, status string) (*domain.PurchaseRequest, error) {
	p := m.find(id)
	if p == nil {
		return nil, domain.ErrPurchaseNotFound
	}
	if p.Status != domain.PurchasePending {
		return nil, domain.ErrPurchaseDecided
	}
	now := time.Now()
	p.Status, p.DecidedAt, p.DecidedBy = status, &now, &admin
	m.system(*p)
	return p, nil
}

func (m *memPurchases) Approve(ctx context.Context, id, admin uuid.UUID) (domain.PurchaseRequest, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	p, err := m.decide(id, admin, domain.PurchasePaid)
	if err != nil {
		return domain.PurchaseRequest{}, err
	}
	if _, err := m.feats.AddCredits(ctx, p.UserID, p.Feature, p.Amount, domain.CreditPurchase, &p.ID, &admin, p.Code); err != nil {
		return domain.PurchaseRequest{}, err
	}
	return *p, nil
}

func (m *memPurchases) Reject(_ context.Context, id, admin uuid.UUID) (domain.PurchaseRequest, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	p, err := m.decide(id, admin, domain.PurchaseRejected)
	if err != nil {
		return domain.PurchaseRequest{}, err
	}
	return *p, nil
}

func (m *memPurchases) AdminIDs(context.Context) ([]uuid.UUID, error) { return m.admins, nil }

// thread: the request's chat thread, made on first use (the lock is held).
func (m *memPurchases) thread(req uuid.UUID) int64 {
	if m.threads == nil {
		m.threads = map[uuid.UUID]int64{}
	}
	if _, ok := m.threads[req]; !ok {
		m.threads[req] = int64(len(m.threads) + 1)
	}
	return m.threads[req]
}

// inThread: the message belongs to the request's thread.
func (m *memPurchases) inThread(msg domain.ChatMessage, req uuid.UUID) bool {
	t, ok := m.threads[req]
	return ok && msg.ThreadID == t
}

// add stores a message in the request's thread (the lock is held).
func (m *memPurchases) add(req uuid.UUID, msg domain.ChatMessage) domain.ChatMessage {
	msg.ID = int64(len(m.msgs) + 1)
	msg.ThreadID = m.thread(req)
	msg.CreatedAt = time.Date(2026, 11, 8, 12, 0, 0, 0, time.UTC).Add(time.Duration(msg.ID) * time.Second)
	m.msgs = append(m.msgs, msg)
	if p := m.find(req); p != nil {
		at := msg.CreatedAt
		p.LastMessageAt = &at
	}
	switch msg.AuthorRole {
	case domain.ChatAuthorAdmin:
		m.markRead(req, msg.ID)
	case domain.ChatAuthorUser:
		m.markUserRead(req, msg.ID)
	}
	return msg
}

func (m *memPurchases) system(p domain.PurchaseRequest) {
	event, body := domain.ChatEventCancelled, domain.ChatCancelledText
	if p.Status == domain.PurchasePaid {
		event, body = domain.ChatEventPaid, domain.ChatPaidText(p.Amount)
	}
	m.add(p.ID, domain.ChatMessage{AuthorRole: domain.ChatAuthorSystem, Body: &body, Event: &event})
}

func (m *memPurchases) markRead(id uuid.UUID, upTo int64) {
	if m.read == nil {
		m.read = map[uuid.UUID]int64{}
	}
	m.read[id] = max(m.read[id], upTo)
}

func (m *memPurchases) markUserRead(id uuid.UUID, upTo int64) {
	if m.uread == nil {
		m.uread = map[uuid.UUID]int64{}
	}
	newest := int64(0)
	for _, msg := range m.msgs {
		if m.inThread(msg, id) {
			newest = max(newest, msg.ID)
		}
	}
	m.uread[id] = max(m.uread[id], min(upTo, newest))
}

func (m *memPurchases) MarkUserRead(_ context.Context, id, user uuid.UUID, upTo int64) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if p := m.find(id); p != nil && p.UserID == user {
		m.markUserRead(id, upTo)
	}
	return nil
}

func (m *memPurchases) ChatMarkers(_ context.Context, id uuid.UUID) (domain.ChatReadMarkers, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return domain.ChatReadMarkers{User: m.uread[id], Admin: m.read[id]}, nil
}

func (m *memPurchases) unread(id uuid.UUID) int {
	n := 0
	for _, msg := range m.msgs {
		if m.inThread(msg, id) && msg.AuthorRole == domain.ChatAuthorUser && msg.ID > m.read[id] {
			n++
		}
	}
	return n
}

func (m *memPurchases) Get(_ context.Context, id uuid.UUID) (domain.PurchaseRequest, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	p := m.find(id)
	if p == nil {
		return domain.PurchaseRequest{}, domain.ErrPurchaseNotFound
	}
	out := *p
	out.UserEmail, out.Unread = p.UserID.String()[:8]+"@test", m.unread(id)
	return out, nil
}

func (m *memPurchases) AddMessage(_ context.Context, req uuid.UUID, msg domain.ChatMessage, img *domain.ChatImage) (domain.ChatMessage, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	p := m.find(req)
	if p == nil {
		return domain.ChatMessage{}, domain.ErrPurchaseNotFound
	}
	if !domain.ChatOpen(p.Status) {
		return domain.ChatMessage{}, domain.ErrChatClosed
	}
	if img != nil {
		if m.images == nil {
			m.images = map[string]domain.ChatImage{}
		}
		m.images[img.Key] = *img
	}
	return m.add(req, msg), nil
}

func (m *memPurchases) Messages(_ context.Context, id uuid.UUID, after int64, limit int, viewerRole string) ([]domain.ChatMessage, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []domain.ChatMessage
	for _, msg := range m.msgs {
		if m.inThread(msg, id) && msg.ID > after && msg.VisibleTo(viewerRole) && len(out) < limit {
			out = append(out, msg)
		}
	}
	return out, nil
}

func (m *memPurchases) MarkAdminRead(_ context.Context, id uuid.UUID, upTo int64) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.markRead(id, upTo)
	return nil
}

func (m *memPurchases) MessageImage(_ context.Context, id uuid.UUID, mid int64) (domain.ChatMessage, domain.ChatImage, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, msg := range m.msgs {
		if msg.ID == mid && m.inThread(msg, id) && msg.ImageKey != nil {
			return msg, m.images[*msg.ImageKey], nil
		}
	}
	return domain.ChatMessage{}, domain.ChatImage{}, domain.ErrNotFound
}

// fakeTelegram records chat notifications; linked = users with a Telegram chat, err = the bot fails.
type fakeTelegram struct {
	mu     sync.Mutex
	linked map[uuid.UUID]bool
	err    error
	sent   []sentPush // title = the text, body unused
}

func (f *fakeTelegram) NotifyUser(_ context.Context, u uuid.UUID, text string) (bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if !f.linked[u] {
		return false, nil
	}
	if f.err != nil {
		return false, f.err
	}
	f.sent = append(f.sent, sentPush{to: []uuid.UUID{u}, title: text})
	return true, nil
}

func (f *fakeTelegram) all() []sentPush {
	f.mu.Lock()
	defer f.mu.Unlock()
	return slices.Clone(f.sent)
}

type sentPush struct {
	to          []uuid.UUID
	title, body string
}

// fakeNotifier records the pushes; off = push not configured, err = the push service fails.
type fakeNotifier struct {
	mu   sync.Mutex
	off  bool
	err  error
	sent []sentPush
}

func (f *fakeNotifier) Enabled() bool { return !f.off }
func (f *fakeNotifier) SendTo(_ context.Context, t service.PushTarget, title, body string) (domain.PushResult, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.sent = append(f.sent, sentPush{t.UserIDs, title, body})
	return domain.PushResult{Sent: 1}, f.err
}
func (f *fakeNotifier) all() []sentPush {
	f.mu.Lock()
	defer f.mu.Unlock()
	return slices.Clone(f.sent)
}

type purchaseEnv struct {
	r                  *gin.Engine
	feats              *memFeatures
	fs                 *service.FeatureService
	svc                *service.PurchaseService
	push               *fakeNotifier
	tg                 *fakeTelegram
	repo               *memPurchases
	user, other, admin uuid.UUID
}

// newPurchaseEnv: the purchase routes as in the router; the caller is e.user unless X-Test-User
// says otherwise, and e.admin is the only admin. noPayment = buying is off.
func newPurchaseEnv(payment domain.PaymentInfo) purchaseEnv {
	gin.SetMode(gin.TestMode)
	e := purchaseEnv{user: uuid.New(), other: uuid.New(), admin: uuid.New(), push: &fakeNotifier{}, tg: &fakeTelegram{linked: map[uuid.UUID]bool{}}}
	e.feats = &memFeatures{ov: map[string]domain.FeatureOverride{}}
	for _, u := range []uuid.UUID{e.user, e.other, e.admin} {
		e.feats.knowUser(u)
	}
	e.fs = service.NewFeatureService(e.feats)
	repo := &memPurchases{feats: e.feats, admins: []uuid.UUID{e.admin}}
	e.repo = repo
	e.svc = service.NewPurchaseService(repo, e.feats, e.push, e.tg, payment)
	h := NewPurchaseHandler(e.svc)
	r := gin.New()
	r.Use(func(c *gin.Context) {
		id := e.user
		if v := c.GetHeader("X-Test-User"); v != "" {
			id = uuid.MustParse(v)
		}
		c.Set(userIDKey, id)
		role := domain.RoleUser
		if id == e.admin {
			role = domain.RoleAdmin
		}
		c.Set(roleKey, role)
	})
	r.GET("/me/purchases", h.Overview)
	r.POST("/me/purchases", h.Create)
	r.DELETE("/me/purchases/:id", h.Cancel)
	r.GET("/me/purchases/:id/messages", h.BuyerChat)
	r.POST("/me/purchases/:id/messages", h.BuyerPost)
	r.POST("/me/purchases/:id/read", h.BuyerRead)
	r.GET("/me/purchases/:id/messages/:mid/image", h.BuyerImage)
	admin := r.Group("/admin", RequireAdmin())
	admin.GET("/purchases/:id/messages", h.AdminChat)
	admin.POST("/purchases/:id/messages", h.AdminPost)
	admin.GET("/purchases/:id/messages/:mid/image", h.AdminImage)
	admin.GET("/purchases", h.AdminList)
	admin.POST("/purchases/:id/approve", h.Approve)
	admin.POST("/purchases/:id/reject", h.Reject)
	admin.POST("/users/:id/credits", h.Grant)
	e.r = r
	return e
}

func (e purchaseEnv) as(who uuid.UUID, method, path, body string) *httptest.ResponseRecorder {
	w := httptest.NewRecorder()
	req := httptest.NewRequest(method, path, bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Test-User", who.String())
	e.r.ServeHTTP(w, req)
	return w
}

// buy creates a request for pack as who and returns its id (fails the test unless 201).
func (e purchaseEnv) buy(t *testing.T, who uuid.UUID, pack string) string {
	t.Helper()
	w := e.as(who, "POST", "/me/purchases", `{"pack_id":"`+pack+`"}`)
	if w.Code != 201 {
		t.Fatalf("buy %s: %d %s", pack, w.Code, w.Body)
	}
	return decode(t, w)["id"].(string)
}

func (e purchaseEnv) photoCredits(t *testing.T, u uuid.UUID) int {
	t.Helper()
	st, err := e.fs.State(context.Background(), u, domain.FeaturePhotoImport)
	if err != nil {
		t.Fatal(err)
	}
	return st.Credits
}

var codeRe = regexp.MustCompile(`^YD-\d{4}$`)

func TestPurchases_CreateListCancel(t *testing.T) {
	e := newPurchaseEnv(cardAndTelegram)

	w := e.as(e.user, "GET", "/me/purchases", "")
	m := decode(t, w)
	packs, _ := m["packs"].([]any)
	if w.Code != 200 || len(packs) != 2 {
		t.Fatalf("overview: %d %s", w.Code, w.Body)
	}
	if p := packs[0].(map[string]any); p["id"] != "photo_35" || p["feature"] != "photo_import" || p["amount"] != float64(35) || p["price_uzs"] != float64(25000) {
		t.Errorf("first pack: %v", p)
	}
	if p := packs[1].(map[string]any); p["id"] != "photo_100" || p["amount"] != float64(100) || p["price_uzs"] != float64(59000) {
		t.Errorf("second pack: %v", p)
	}
	if pay := m["payment"].(map[string]any); pay["card_number"] != testCard || pay["card_holder"] != "TEST HOLDER" || pay["telegram"] != "yodla_help" {
		t.Errorf("payment: %v", pay)
	}
	if reqs, ok := m["requests"].([]any); !ok || len(reqs) != 0 {
		t.Errorf("no requests yet must be [], not null: %s", w.Body)
	}

	w = e.as(e.user, "POST", "/me/purchases", `{"pack_id":"photo_35"}`)
	created := decode(t, w)
	if w.Code != 201 || !codeRe.MatchString(fmt.Sprint(created["code"])) || created["pack_id"] != "photo_35" || created["amount"] != float64(35) ||
		created["price_uzs"] != float64(25000) || created["status"] != "pending" || created["id"] == "" || created["created_at"] == nil {
		t.Fatalf("create: %d %s", w.Code, w.Body)
	}
	for _, private := range []string{"user_id", "decided_by", "user_email"} {
		if _, ok := created[private]; ok {
			t.Errorf("the user's view must not carry %s: %s", private, w.Body)
		}
	}
	first := created["id"].(string)
	second := e.buy(t, e.user, "photo_100")

	// the admins are told about every new request
	e.svc.Wait()
	sent := e.push.all()
	// Each push goes out in its own goroutine: the order they arrive in is not fixed.
	if len(sent) == 2 && strings.Contains(sent[0].title, "100 фото") {
		sent[0], sent[1] = sent[1], sent[0]
	}
	if len(sent) != 2 || !slices.Equal(sent[0].to, []uuid.UUID{e.admin}) ||
		sent[0].title != fmt.Sprintf("Новая заявка %s · 35 фото · 25 000 сум", created["code"]) || sent[0].body == "" ||
		!strings.HasSuffix(sent[1].title, " · 100 фото · 59 000 сум") {
		t.Errorf("admin pushes: %+v", sent)
	}

	m = decode(t, e.as(e.user, "GET", "/me/purchases", ""))
	if reqs := m["requests"].([]any); len(reqs) != 2 || reqs[0].(map[string]any)["id"] != second || reqs[1].(map[string]any)["id"] != first {
		t.Errorf("newest first: %v", m["requests"])
	}
	if reqs := decode(t, e.as(e.other, "GET", "/me/purchases", ""))["requests"].([]any); len(reqs) != 0 {
		t.Errorf("someone else's requests are not listed: %v", reqs)
	}

	// cancel: only the own pending request; everything else is 404
	for name, c := range map[string]struct {
		who  uuid.UUID
		path string
		want int
	}{
		"someone else's": {e.other, "/me/purchases/" + first, 404},
		"missing":        {e.user, "/me/purchases/" + uuid.NewString(), 404},
		"bad id":         {e.user, "/me/purchases/x", 400},
	} {
		if w := e.as(c.who, "DELETE", c.path, ""); w.Code != c.want {
			t.Errorf("%s: %d, want %d (%s)", name, w.Code, c.want, w.Body)
		}
	}
	if w := e.as(e.user, "DELETE", "/me/purchases/"+first, ""); w.Code != 204 {
		t.Fatalf("cancel own: %d %s", w.Code, w.Body)
	}
	if w := e.as(e.user, "DELETE", "/me/purchases/"+first, ""); w.Code != 404 {
		t.Errorf("cancelled twice: %d", w.Code)
	}
	m = decode(t, e.as(e.user, "GET", "/me/purchases", ""))
	if r := m["requests"].([]any)[1].(map[string]any); r["status"] != "cancelled" || r["decided_at"] == nil {
		t.Errorf("after cancel: %v", r)
	}

	for name, body := range map[string]string{"unknown pack": `{"pack_id":"photo_9999"}`, "no pack": `{}`, "bad json": `{`} {
		if w := e.as(e.user, "POST", "/me/purchases", body); w.Code != 400 {
			t.Errorf("%s: %d %s", name, w.Code, w.Body)
		}
	}
}

func TestPurchases_FourthPendingIs409(t *testing.T) {
	e := newPurchaseEnv(cardAndTelegram)
	var ids []string
	for range 3 {
		ids = append(ids, e.buy(t, e.user, "photo_35"))
	}
	w := e.as(e.user, "POST", "/me/purchases", `{"pack_id":"photo_35"}`)
	if m := decode(t, w); w.Code != 409 || m["code"] != "too_many_pending" {
		t.Fatalf("4th pending: %d %s", w.Code, w.Body)
	}
	e.buy(t, e.other, "photo_35") // the cap is per user
	// a decided request no longer counts
	if w := e.as(e.user, "DELETE", "/me/purchases/"+ids[0], ""); w.Code != 204 {
		t.Fatal(w.Code)
	}
	e.buy(t, e.user, "photo_100")
}

func TestPurchases_AdminApproveReject(t *testing.T) {
	e := newPurchaseEnv(cardAndTelegram)
	paid := e.buy(t, e.user, "photo_35")
	rejected := e.buy(t, e.user, "photo_100")
	e.svc.Wait()
	before := len(e.push.all())

	// not for users
	for _, c := range []struct{ method, path, body string }{
		{"GET", "/admin/purchases", ""},
		{"POST", "/admin/purchases/" + paid + "/approve", ""},
		{"POST", "/admin/purchases/" + paid + "/reject", ""},
		{"POST", "/admin/users/" + e.user.String() + "/credits", `{"feature":"photo_import","amount":5}`},
	} {
		if w := e.as(e.user, c.method, c.path, c.body); w.Code != 403 {
			t.Errorf("non-admin %s %s: %d", c.method, c.path, w.Code)
		}
	}
	if e.photoCredits(t, e.user) != 0 {
		t.Fatal("a refused approval must not credit anything")
	}

	w := e.as(e.admin, "GET", "/admin/purchases", "")
	reqs, _ := decode(t, w)["requests"].([]any)
	if w.Code != 200 || len(reqs) != 2 {
		t.Fatalf("pending by default: %d %s", w.Code, w.Body)
	}
	if r := reqs[0].(map[string]any); r["user_id"] != e.user.String() || r["user_email"] == "" || r["status"] != "pending" {
		t.Errorf("admin view: %v", r)
	}

	w = e.as(e.admin, "POST", "/admin/purchases/"+paid+"/approve", "")
	r := decode(t, w)
	if w.Code != 200 || r["status"] != "paid" || r["decided_by"] != e.admin.String() || r["decided_at"] == nil || r["amount"] != float64(35) {
		t.Fatalf("approve: %d %s", w.Code, w.Body)
	}
	if n := e.photoCredits(t, e.user); n != 35 {
		t.Errorf("credits after approval: %d", n)
	}
	e.svc.Wait()
	sent := e.push.all()[before:]
	if len(sent) != 1 || !slices.Equal(sent[0].to, []uuid.UUID{e.user}) || sent[0].title != "Фото начислены" || sent[0].body != "+35 фото уже на счету" {
		t.Errorf("the user's push: %+v", sent)
	}

	// a decided request cannot be decided again, and its credits are never added twice
	for _, path := range []string{"/admin/purchases/" + paid + "/approve", "/admin/purchases/" + paid + "/reject"} {
		w := e.as(e.admin, "POST", path, "")
		if m := decode(t, w); w.Code != 409 || m["code"] != "already_decided" {
			t.Errorf("%s again: %d %s", path, w.Code, w.Body)
		}
	}
	if n := e.photoCredits(t, e.user); n != 35 {
		t.Errorf("approved twice → credits %d, want 35", n)
	}

	w = e.as(e.admin, "POST", "/admin/purchases/"+rejected+"/reject", "")
	if r := decode(t, w); w.Code != 200 || r["status"] != "rejected" || r["decided_by"] != e.admin.String() {
		t.Fatalf("reject: %d %s", w.Code, w.Body)
	}
	if w := e.as(e.admin, "POST", "/admin/purchases/"+rejected+"/approve", ""); w.Code != 409 {
		t.Errorf("approve a rejected one: %d", w.Code)
	}
	if n := e.photoCredits(t, e.user); n != 35 {
		t.Errorf("a rejection adds nothing: %d", n)
	}
	if w := e.as(e.user, "DELETE", "/me/purchases/"+paid, ""); w.Code != 404 {
		t.Errorf("cancel a decided one: %d", w.Code)
	}

	for name, c := range map[string]struct {
		path string
		want int
	}{
		"missing": {"/admin/purchases/" + uuid.NewString() + "/approve", 404},
		"bad id":  {"/admin/purchases/x/reject", 400},
	} {
		if w := e.as(e.admin, "POST", c.path, ""); w.Code != c.want {
			t.Errorf("%s: %d, want %d", name, w.Code, c.want)
		}
	}

	for status, want := range map[string]int{"": 0, "pending": 0, "paid": 1, "rejected": 1, "cancelled": 0, "all": 2} {
		w := e.as(e.admin, "GET", "/admin/purchases?status="+status, "")
		if reqs, _ := decode(t, w)["requests"].([]any); w.Code != 200 || len(reqs) != want {
			t.Errorf("status=%q: %d %s, want %d", status, w.Code, w.Body, want)
		}
	}
	if w := e.as(e.admin, "GET", "/admin/purchases?status=bogus", ""); w.Code != 400 {
		t.Errorf("unknown status: %d", w.Code)
	}
}

func TestPurchases_AdminGrant(t *testing.T) {
	e := newPurchaseEnv(cardAndTelegram)
	path := "/admin/users/" + e.user.String() + "/credits"
	for _, c := range []struct {
		body string
		want float64
	}{
		{`{"feature":"photo_import","amount":10,"note":"сбой оплаты"}`, 10},
		{`{"feature":"photo_import","amount":-4}`, 6},
	} {
		w := e.as(e.admin, "POST", path, c.body)
		if m := decode(t, w); w.Code != 200 || m["balance"] != c.want {
			t.Fatalf("%s: %d %s", c.body, w.Code, w.Body)
		}
	}
	for name, c := range map[string]struct {
		path, body string
		want       int
	}{
		"below 0":         {path, `{"feature":"photo_import","amount":-7}`, 400},
		"zero":            {path, `{"feature":"photo_import","amount":0}`, 400},
		"no amount":       {path, `{"feature":"photo_import"}`, 400},
		"unknown feature": {path, `{"feature":"nope","amount":5}`, 400},
		"no feature":      {path, `{"amount":5}`, 400},
		"too long note":   {path, `{"feature":"photo_import","amount":5,"note":"` + strings.Repeat("я", 501) + `"}`, 400},
		"bad json":        {path, `{`, 400},
		"bad user id":     {"/admin/users/x/credits", `{"feature":"photo_import","amount":5}`, 400},
		"unknown user":    {"/admin/users/" + uuid.NewString() + "/credits", `{"feature":"photo_import","amount":5}`, 404},
	} {
		if w := e.as(e.admin, "POST", c.path, c.body); w.Code != c.want {
			t.Errorf("%s: %d, want %d (%s)", name, w.Code, c.want, strings.TrimSpace(w.Body.String()))
		}
	}
	if n := e.photoCredits(t, e.user); n != 6 {
		t.Errorf("refused grants change nothing: %d", n)
	}
}

// Either way to pay is enough: a card, or a Telegram contact where the payment is arranged. The
// one that is not set comes back as "".
func TestPurchases_CardOrTelegramIsEnough(t *testing.T) {
	for name, c := range map[string]struct {
		payment          domain.PaymentInfo
		card, holder, tg string
	}{
		"telegram only": {telegramOnly, "", "", "yodla_pay"},
		"card only":     {cardOnly, testCard, "TEST HOLDER", ""},
	} {
		e := newPurchaseEnv(c.payment)
		w := e.as(e.user, "GET", "/me/purchases", "")
		if w.Code != 200 {
			t.Fatalf("%s: overview %d %s", name, w.Code, w.Body)
		}
		pay := decode(t, w)["payment"].(map[string]any)
		if pay["card_number"] != c.card || pay["card_holder"] != c.holder || pay["telegram"] != c.tg {
			t.Errorf("%s: payment %v", name, pay)
		}
		id := e.buy(t, e.user, "photo_35")
		if w := e.as(e.user, "DELETE", "/me/purchases/"+id, ""); w.Code != 204 {
			t.Errorf("%s: cancel %d", name, w.Code)
		}
	}
}

func TestPurchases_NoCardNorTelegramIs503(t *testing.T) {
	e := newPurchaseEnv(noPayment)
	for _, c := range []struct{ method, path, body string }{
		{"GET", "/me/purchases", ""},
		{"POST", "/me/purchases", `{"pack_id":"photo_35"}`},
		{"DELETE", "/me/purchases/" + uuid.NewString(), ""},
	} {
		w := e.as(e.user, c.method, c.path, c.body)
		if m := decode(t, w); w.Code != 503 || m["code"] != "payments_unavailable" {
			t.Errorf("%s %s: %d %s", c.method, c.path, w.Code, w.Body)
		}
	}
	// the admin can still settle what is left
	if w := e.as(e.admin, "GET", "/admin/purchases", ""); w.Code != 200 {
		t.Errorf("admin list: %d", w.Code)
	}
	if len(e.push.all()) != 0 {
		t.Error("nothing to tell anyone")
	}
}

// Push switched off or failing never fails the purchase itself.
func TestPurchases_PushOffOrFailingIsIgnored(t *testing.T) {
	e := newPurchaseEnv(cardAndTelegram)
	e.push.off = true
	id := e.buy(t, e.user, "photo_35")
	if w := e.as(e.admin, "POST", "/admin/purchases/"+id+"/approve", ""); w.Code != 200 {
		t.Fatalf("approve with push off: %d", w.Code)
	}
	e.svc.Wait()
	if len(e.push.all()) != 0 {
		t.Errorf("push off must send nothing: %+v", e.push.all())
	}

	e2 := newPurchaseEnv(cardAndTelegram)
	e2.push.err = errors.New("push service down")
	id = e2.buy(t, e2.user, "photo_35")
	if w := e2.as(e2.admin, "POST", "/admin/purchases/"+id+"/approve", ""); w.Code != 200 {
		t.Fatalf("approve with a failing push: %d", w.Code)
	}
	e2.svc.Wait()
	if n := e2.photoCredits(t, e2.user); n != 35 {
		t.Errorf("credits %d", n)
	}
}

type activeUsers map[uuid.UUID]string // id → role

func (a activeUsers) UserStatus(_ context.Context, id uuid.UUID) (string, string, bool, error) {
	role, ok := a[id]
	if !ok {
		return "", "", false, domain.ErrNotFound
	}
	return role, "de", false, nil
}

// Through the real router: the purchase routes need a login, the admin ones the admin role, and a
// user may create 5 requests an hour.
func TestPurchaseRoutes_AuthAdminAndRateLimit(t *testing.T) {
	gin.SetMode(gin.TestMode)
	e := newPurchaseEnv(cardAndTelegram)
	tokens := auth.NewTokenManager(strings.Repeat("k", 32), "test", time.Minute, time.Hour)
	r := NewRouter(RouterDeps{
		CORSOrigins: []string{"http://localhost"}, Tokens: tokens, Ctx: context.Background(),
		Purchases:  NewPurchaseHandler(e.svc),
		UserStatus: activeUsers{e.user: domain.RoleUser, e.admin: domain.RoleAdmin},
	})
	send := func(who *uuid.UUID, method, path, body string) *httptest.ResponseRecorder {
		w := httptest.NewRecorder()
		req := httptest.NewRequest(method, path, bytes.NewBufferString(body))
		req.Header.Set("Content-Type", "application/json")
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
	id := uuid.NewString()
	for _, c := range []struct{ method, path string }{
		{"GET", "/api/me/purchases"},
		{"POST", "/api/me/purchases"},
		{"DELETE", "/api/me/purchases/" + id},
		{"GET", "/api/admin/purchases"},
		{"POST", "/api/admin/purchases/" + id + "/approve"},
		{"POST", "/api/admin/purchases/" + id + "/reject"},
		{"POST", "/api/admin/users/" + id + "/credits"},
	} {
		if w := send(nil, c.method, c.path, ""); w.Code != 401 {
			t.Errorf("%s %s without login: %d, want 401", c.method, c.path, w.Code)
		}
	}
	if w := send(&e.user, "GET", "/api/admin/purchases", ""); w.Code != 403 {
		t.Errorf("admin route as a user: %d", w.Code)
	}
	if w := send(&e.admin, "GET", "/api/admin/purchases", ""); w.Code != 200 {
		t.Errorf("admin route as the admin: %d %s", w.Code, w.Body)
	}
	if w := send(&e.user, "GET", "/api/me/purchases", ""); w.Code != 200 {
		t.Errorf("overview: %d %s", w.Code, w.Body)
	}

	// 3 created, 2 refused (3 pending), the 6th is over the hourly limit
	var codes []int
	for range 6 {
		codes = append(codes, send(&e.user, "POST", "/api/me/purchases", `{"pack_id":"photo_35"}`).Code)
	}
	if !slices.Equal(codes, []int{201, 201, 201, 409, 409, 429}) {
		t.Errorf("codes %v", codes)
	}
}
