package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"mime/multipart"
	"net/http/httptest"
	"sort"
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

// memSupport is an in-memory service.SupportRepository with the postgres rules: one thread per
// user, hidden messages filtered by the viewer's side, an admin's message marks the thread read.
type memSupport struct {
	mu      sync.Mutex
	byUser  map[uuid.UUID]int64
	threads map[int64]*domain.ChatThread
	msgs    []domain.ChatMessage
	read    map[int64]int64
	uread   map[int64]int64
	images  map[string]domain.ChatImage
	emails  map[uuid.UUID]string
}

func newMemSupport() *memSupport {
	return &memSupport{byUser: map[uuid.UUID]int64{}, threads: map[int64]*domain.ChatThread{}, read: map[int64]int64{}, uread: map[int64]int64{},
		images: map[string]domain.ChatImage{}, emails: map[uuid.UUID]string{}}
}

func (m *memSupport) EnsureThread(_ context.Context, u uuid.UUID) (domain.ChatThread, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if id, ok := m.byUser[u]; ok {
		return m.view(id), nil
	}
	id := int64(len(m.threads) + 1)
	m.threads[id] = &domain.ChatThread{ID: id, Kind: domain.ChatKindSupport, UserID: u, CreatedAt: time.Now()}
	m.byUser[u] = id
	return *m.threads[id], nil
}

func (m *memSupport) unread(id int64) int {
	n := 0
	for _, msg := range m.msgs {
		if msg.ThreadID == id && msg.AuthorRole == domain.ChatAuthorUser && msg.ID > m.read[id] {
			n++
		}
	}
	return n
}

func (m *memSupport) view(id int64) domain.ChatThread {
	t := *m.threads[id]
	t.UserEmail, t.Unread = m.emails[t.UserID], m.unread(id)
	t.ReadMarkers = domain.ChatReadMarkers{User: m.uread[id], Admin: m.read[id]}
	for i := len(m.msgs) - 1; i >= 0; i-- {
		if m.msgs[i].ThreadID == id {
			last := m.msgs[i]
			t.LastMessage = &last
			break
		}
	}
	return t
}

func (m *memSupport) Thread(_ context.Context, id int64) (domain.ChatThread, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.threads[id] == nil {
		return domain.ChatThread{}, domain.ErrNotFound
	}
	return m.view(id), nil
}

func (m *memSupport) Threads(_ context.Context, unreadOnly bool, limit int) ([]domain.ChatThread, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []domain.ChatThread
	for id, t := range m.threads {
		v := m.view(id)
		if t.LastMessageAt == nil || (unreadOnly && v.Unread == 0) {
			continue
		}
		out = append(out, v)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].LastMessageAt.After(*out[j].LastMessageAt) })
	if len(out) > limit {
		out = out[:limit]
	}
	return out, nil
}

func (m *memSupport) AddMessage(_ context.Context, threadID int64, msg domain.ChatMessage, img *domain.ChatImage) (domain.ChatMessage, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	t := m.threads[threadID]
	if t == nil {
		return domain.ChatMessage{}, domain.ErrNotFound
	}
	if img != nil {
		m.images[img.Key] = *img
	}
	msg.ID, msg.ThreadID = int64(len(m.msgs)+1), threadID
	msg.CreatedAt = time.Date(2026, 11, 8, 12, 0, 0, 0, time.UTC).Add(time.Duration(msg.ID) * time.Second)
	m.msgs = append(m.msgs, msg)
	at := msg.CreatedAt
	t.LastMessageAt = &at
	switch msg.AuthorRole {
	case domain.ChatAuthorAdmin:
		m.read[threadID] = max(m.read[threadID], msg.ID)
	case domain.ChatAuthorUser:
		m.uread[threadID] = max(m.uread[threadID], msg.ID)
	}
	return msg, nil
}

func (m *memSupport) Messages(_ context.Context, threadID, after int64, limit int, viewerRole string) ([]domain.ChatMessage, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []domain.ChatMessage
	for _, msg := range m.msgs {
		if msg.ThreadID == threadID && msg.ID > after && msg.VisibleTo(viewerRole) && len(out) < limit {
			out = append(out, msg)
		}
	}
	return out, nil
}

func (m *memSupport) MarkRead(_ context.Context, threadID, upTo int64) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if upTo == 0 {
		for _, msg := range m.msgs {
			if msg.ThreadID == threadID {
				upTo = max(upTo, msg.ID)
			}
		}
	}
	m.read[threadID] = max(m.read[threadID], upTo)
	return nil
}

func (m *memSupport) MarkUserRead(_ context.Context, user uuid.UUID, threadID, upTo int64) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if t := m.threads[threadID]; t == nil || t.UserID != user {
		return domain.ErrNotFound
	}
	newest := int64(0)
	for _, msg := range m.msgs {
		if msg.ThreadID == threadID {
			newest = max(newest, msg.ID)
		}
	}
	m.uread[threadID] = max(m.uread[threadID], min(upTo, newest))
	return nil
}

func (m *memSupport) MessageImage(_ context.Context, threadID, mid int64) (domain.ChatMessage, domain.ChatImage, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, msg := range m.msgs {
		if msg.ID == mid && msg.ThreadID == threadID && msg.ImageKey != nil {
			return msg, m.images[*msg.ImageKey], nil
		}
	}
	return domain.ChatMessage{}, domain.ChatImage{}, domain.ErrNotFound
}

type supportEnv struct {
	r                  *gin.Engine
	svc                *service.SupportService
	repo               *memSupport
	push               *fakeNotifier
	tg                 *fakeTelegram
	user, other, admin uuid.UUID
}

// newSupportEnv: the support routes as in the router; the caller is X-Test-User (e.admin is the
// only admin).
func newSupportEnv() supportEnv {
	gin.SetMode(gin.TestMode)
	e := supportEnv{user: uuid.New(), other: uuid.New(), admin: uuid.New(), push: &fakeNotifier{},
		tg: &fakeTelegram{linked: map[uuid.UUID]bool{}}, repo: newMemSupport()}
	e.repo.emails[e.user], e.repo.emails[e.other] = "anna@x.co", "bob@x.co"
	e.svc = service.NewSupportService(e.repo, e.push, e.tg)
	h := NewSupportHandler(e.svc)
	r := gin.New()
	r.Use(func(c *gin.Context) {
		id := uuid.MustParse(c.GetHeader("X-Test-User"))
		c.Set(userIDKey, id)
		role := domain.RoleUser
		if id == e.admin {
			role = domain.RoleAdmin
		}
		c.Set(roleKey, role)
	})
	r.GET("/support/messages", h.Messages)
	r.POST("/support/messages", h.Post)
	r.POST("/support/read", h.Read)
	r.GET("/support/messages/:mid/image", h.Image)
	admin := r.Group("/admin", RequireAdmin())
	admin.GET("/support/threads", h.AdminThreads)
	admin.GET("/support/threads/:id/messages", h.AdminMessages)
	admin.POST("/support/threads/:id/messages", h.AdminPost)
	admin.POST("/support/threads/:id/read", h.AdminRead)
	admin.GET("/support/threads/:id/messages/:mid/image", h.AdminImage)
	e.r = r
	return e
}

func (e supportEnv) as(who uuid.UUID, method, path, body string) *httptest.ResponseRecorder {
	w := httptest.NewRecorder()
	req := httptest.NewRequest(method, path, bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Test-User", who.String())
	e.r.ServeHTTP(w, req)
	return w
}

func (e supportEnv) write(t *testing.T, who uuid.UUID, thread int64, body string) chatMsg {
	t.Helper()
	path := "/support/messages"
	if who == e.admin {
		path = fmt.Sprintf("/admin/support/threads/%d/messages", thread)
	}
	b, _ := json.Marshal(map[string]string{"body": body})
	w := e.as(who, "POST", path, string(b))
	if w.Code != 201 {
		t.Fatalf("post as %v: %d %s", who, w.Code, w.Body)
	}
	var m chatMsg
	_ = json.Unmarshal(w.Body.Bytes(), &m)
	return m
}

type userPage struct {
	ThreadID int64     `json:"thread_id"`
	Messages []chatMsg `json:"messages"`
}

func (e supportEnv) mine(t *testing.T, who uuid.UUID, after int64) userPage {
	t.Helper()
	w := e.as(who, "GET", fmt.Sprintf("/support/messages?after=%d", after), "")
	if w.Code != 200 {
		t.Fatalf("get as %v: %d %s", who, w.Code, w.Body)
	}
	var p userPage
	_ = json.Unmarshal(w.Body.Bytes(), &p)
	return p
}

type threadRow struct {
	ID        int64   `json:"id"`
	UserEmail string  `json:"user_email"`
	Unread    int     `json:"unread"`
	Preview   *string `json:"preview"`
}

func (e supportEnv) threads(t *testing.T, query string) []threadRow {
	t.Helper()
	w := e.as(e.admin, "GET", "/admin/support/threads"+query, "")
	if w.Code != 200 {
		t.Fatalf("threads: %d %s", w.Code, w.Body)
	}
	var out struct {
		Threads []threadRow `json:"threads"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &out)
	return out.Threads
}

func TestSupport_OneThreadPerUser_CreatedOnFirstUse(t *testing.T) {
	e := newSupportEnv()
	first := e.mine(t, e.user, 0) // a GET creates it
	if first.ThreadID == 0 || len(first.Messages) != 0 {
		t.Fatalf("first read %+v", first)
	}
	e.write(t, e.user, 0, "Здравствуйте")
	again := e.mine(t, e.user, 0)
	if again.ThreadID != first.ThreadID || len(again.Messages) != 1 {
		t.Errorf("thread %d then %d, messages %d", first.ThreadID, again.ThreadID, len(again.Messages))
	}
	// Writing first also creates it (once).
	m := e.write(t, e.other, 0, "вопрос")
	if m.Author != "user" || !m.Mine {
		t.Errorf("message %+v", m)
	}
	theirs := e.mine(t, e.other, 0)
	if theirs.ThreadID == first.ThreadID {
		t.Error("two users share a thread")
	}
	if n := len(e.repo.threads); n != 2 {
		t.Errorf("%d threads, want 2", n)
	}
}

func TestSupport_UsersSeeOnlyTheirOwnThread(t *testing.T) {
	e := newSupportEnv()
	e.write(t, e.user, 0, "секрет анны")
	for _, msg := range e.mine(t, e.other, 0).Messages {
		if msg.Body != nil && *msg.Body == "секрет анны" {
			t.Fatal("another user's message is visible")
		}
	}
	thread := e.mine(t, e.user, 0).ThreadID
	for _, c := range []struct{ method, path string }{
		{"GET", "/admin/support/threads"},
		{"GET", fmt.Sprintf("/admin/support/threads/%d/messages", thread)},
		{"POST", fmt.Sprintf("/admin/support/threads/%d/messages", thread)},
		{"POST", fmt.Sprintf("/admin/support/threads/%d/read", thread)},
		{"GET", fmt.Sprintf("/admin/support/threads/%d/messages/1/image", thread)},
	} {
		if w := e.as(e.other, c.method, c.path, `{"body":"x"}`); w.Code != 403 {
			t.Errorf("%s %s as a user: %d, want 403", c.method, c.path, w.Code)
		}
	}
	// The photos of a thread are reachable only through its owner's own route.
	if w := e.as(e.other, "GET", "/support/messages/1/image", ""); w.Code != 404 {
		t.Errorf("another user's photo: %d", w.Code)
	}
}

func TestSupport_CardNumberGuard(t *testing.T) {
	e := newSupportEnv()
	m := e.write(t, e.user, 0, fakeCardText)
	if !m.Hidden || m.HiddenReason == nil || *m.HiddenReason != "card_number" || m.Body != nil {
		t.Fatalf("author's answer %+v", m)
	}
	own := e.mine(t, e.user, 0).Messages
	if len(own) != 1 || !own[0].Hidden || own[0].Body != nil {
		t.Errorf("the author sees %+v (the warning, no text)", own)
	}
	thread := e.mine(t, e.user, 0).ThreadID
	w := e.as(e.admin, "GET", fmt.Sprintf("/admin/support/threads/%d/messages", thread), "")
	var adminPage struct {
		Messages []chatMsg `json:"messages"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &adminPage)
	if len(adminPage.Messages) != 1 || adminPage.Messages[0].Body == nil || *adminPage.Messages[0].Body != fakeCardText {
		t.Errorf("admin sees %+v", adminPage.Messages)
	}
	if rows := e.threads(t, ""); len(rows) != 1 || rows[0].Preview == nil || *rows[0].Preview != "[скрыто]" {
		t.Errorf("preview of a hidden message: %+v", rows)
	}

	// An admin's card-like message: never shown to the user, nobody notified.
	pushes := len(e.push.all())
	e.write(t, e.admin, thread, "Карта 8600-1234-5678-9012")
	e.svc.Wait()
	if len(e.push.all()) != pushes {
		t.Error("a hidden message notified the user")
	}
	for _, msg := range e.mine(t, e.user, 0).Messages {
		if msg.Author == "admin" {
			t.Errorf("the user sees the admin's hidden message %+v", msg)
		}
	}
	if m := e.write(t, e.user, 0, "Купил за 25000, код YD-1234"); m.Hidden {
		t.Error("25000 was hidden")
	}
}

func TestSupport_AdminUnreadCountAndRead(t *testing.T) {
	e := newSupportEnv()
	e.write(t, e.user, 0, "первый")
	e.write(t, e.user, 0, "второй")
	e.write(t, e.other, 0, strings.Repeat("длинное сообщение ", 10))
	thread := e.mine(t, e.user, 0).ThreadID

	rows := e.threads(t, "")
	byID := map[int64]threadRow{}
	for _, r := range rows {
		byID[r.ID] = r
	}
	if len(rows) != 2 || rows[0].UserEmail != "bob@x.co" { // the newest conversation first
		t.Fatalf("threads %+v", rows)
	}
	if byID[thread].Unread != 2 || *byID[thread].Preview != "второй" {
		t.Errorf("my thread %+v", byID[thread])
	}
	if p := []rune(*rows[0].Preview); len(p) != domain.ChatPreviewMax || p[len(p)-1] != '…' {
		t.Errorf("long preview %q (%d characters)", string(p), len(p))
	}

	// Reading the messages does not mark them read; the read endpoint does.
	if w := e.as(e.admin, "GET", fmt.Sprintf("/admin/support/threads/%d/messages", thread), ""); w.Code != 200 {
		t.Fatal(w.Code)
	}
	if n := byIDOf(e.threads(t, ""), thread).Unread; n != 2 {
		t.Errorf("after reading the messages: unread %d", n)
	}
	w := e.as(e.admin, "POST", fmt.Sprintf("/admin/support/threads/%d/read", thread), "")
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"unread":0`) {
		t.Fatalf("read: %d %s", w.Code, w.Body)
	}
	if n := byIDOf(e.threads(t, ""), thread).Unread; n != 0 {
		t.Errorf("after read: unread %d", n)
	}
	if unread := e.threads(t, "?unread=1"); len(unread) != 1 || unread[0].ID == thread {
		t.Errorf("unread=1: %+v", unread)
	}

	// Read up to a message: what came after stays unread. An admin's reply marks it read.
	third := e.write(t, e.user, 0, "третий")
	e.write(t, e.user, 0, "четвёртый")
	if w := e.as(e.admin, "POST", fmt.Sprintf("/admin/support/threads/%d/read", thread), fmt.Sprintf(`{"up_to":%d}`, third.ID)); w.Code != 200 {
		t.Fatal(w.Code)
	}
	if n := byIDOf(e.threads(t, ""), thread).Unread; n != 1 {
		t.Errorf("read up to the third: unread %d, want 1", n)
	}
	e.write(t, e.admin, thread, "Отвечаем")
	if n := byIDOf(e.threads(t, ""), thread).Unread; n != 0 {
		t.Errorf("after an admin reply: unread %d", n)
	}
	for _, c := range []struct{ path, body string }{
		{"/admin/support/threads/999/read", ""},
		{"/admin/support/threads/999/messages", `{"body":"x"}`},
	} {
		if w := e.as(e.admin, "POST", c.path, c.body); w.Code != 404 {
			t.Errorf("%s: %d", c.path, w.Code)
		}
	}
	if w := e.as(e.admin, "POST", "/admin/support/threads/abc/read", ""); w.Code != 400 {
		t.Errorf("bad id: %d", w.Code)
	}
	if w := e.as(e.admin, "POST", fmt.Sprintf("/admin/support/threads/%d/read", thread), `{"up_to":-1}`); w.Code != 400 {
		t.Errorf("negative up_to: %d", w.Code)
	}
}

func byIDOf(rows []threadRow, id int64) threadRow {
	for _, r := range rows {
		if r.ID == id {
			return r
		}
	}
	return threadRow{}
}

func TestSupport_AdminReplyNotifiesWithoutText(t *testing.T) {
	e := newSupportEnv()
	e.write(t, e.user, 0, "помогите")
	thread := e.mine(t, e.user, 0).ThreadID

	e.write(t, e.admin, thread, "Секретный ответ")
	e.svc.Wait()
	pushes := e.push.all()
	if len(pushes) != 1 || pushes[0].to[0] != e.user || pushes[0].title != "Новый ответ в поддержке Yodla" ||
		pushes[0].body != "Откройте сайт, чтобы ответить." {
		t.Fatalf("push %+v", pushes)
	}
	e.tg.linked[e.user] = true
	e.write(t, e.admin, thread, "Ещё ответ")
	e.svc.Wait()
	if sent := e.tg.all(); len(sent) != 1 || sent[0].title != "Новый ответ в поддержке Yodla. Откройте сайт, чтобы ответить." {
		t.Errorf("telegram %+v", sent)
	}
	if len(e.push.all()) != 1 {
		t.Error("a user with Telegram also got a push")
	}
	e.tg.err = errors.New("bot down")
	e.write(t, e.admin, thread, "И ещё")
	e.svc.Wait()
	if len(e.push.all()) != 2 {
		t.Error("no push after Telegram failed")
	}
	before := len(e.push.all())
	e.write(t, e.user, 0, "спасибо")
	e.svc.Wait()
	if len(e.push.all()) != before {
		t.Error("the user's own message notified someone")
	}
	for _, p := range e.push.all() {
		if text := p.title + p.body; strings.Contains(text, "Секретный ответ") || strings.Contains(text, "Ещё ответ") || strings.Contains(text, "И ещё") {
			t.Errorf("the push carries the message: %+v", p)
		}
	}
}

func TestSupport_ValidationAndPhotos(t *testing.T) {
	e := newSupportEnv()
	for name, body := range map[string]string{
		"empty": `{"body":""}`, "spaces": `{"body":"  \n "}`, "no body": `{}`,
		"too long": `{"body":"` + strings.Repeat("я", domain.MaxChatBody+1) + `"}`,
	} {
		if w := e.as(e.user, "POST", "/support/messages", body); w.Code != 400 {
			t.Errorf("%s: %d", name, w.Code)
		}
	}
	if m := e.write(t, e.user, 0, "  "+strings.Repeat("я", domain.MaxChatBody)+"  "); m.Body == nil || len([]rune(*m.Body)) != domain.MaxChatBody {
		t.Error("1000 characters (trimmed) must pass")
	}
	if w := e.as(e.user, "GET", "/support/messages?after=-1", ""); w.Code != 400 {
		t.Errorf("after=-1: %d", w.Code)
	}

	upload := func(who uuid.UUID, path string, image []byte) *httptest.ResponseRecorder {
		var buf bytes.Buffer
		mw := multipart.NewWriter(&buf)
		fw, _ := mw.CreateFormFile("image", "shot.png")
		_, _ = fw.Write(image)
		_ = mw.Close()
		w := httptest.NewRecorder()
		req := httptest.NewRequest("POST", path, &buf)
		req.Header.Set("Content-Type", mw.FormDataContentType())
		req.Header.Set("X-Test-User", who.String())
		e.r.ServeHTTP(w, req)
		return w
	}
	w := upload(e.user, "/support/messages", pngBytes)
	if w.Code != 201 {
		t.Fatalf("photo: %d %s", w.Code, w.Body)
	}
	var m chatMsg
	_ = json.Unmarshal(w.Body.Bytes(), &m)
	thread := e.mine(t, e.user, 0).ThreadID
	if img := e.as(e.user, "GET", fmt.Sprintf("/support/messages/%d/image", m.ID), ""); img.Code != 200 || !bytes.Equal(img.Body.Bytes(), pngBytes) {
		t.Errorf("own photo: %d", img.Code)
	}
	if img := e.as(e.admin, "GET", fmt.Sprintf("/admin/support/threads/%d/messages/%d/image", thread, m.ID), ""); img.Code != 200 ||
		img.Header().Get("Content-Type") != "image/png" {
		t.Errorf("admin photo: %d", img.Code)
	}
	if rows := e.threads(t, ""); *rows[0].Preview != "[фото]" {
		t.Errorf("photo preview %q", *rows[0].Preview)
	}
	if w := upload(e.user, "/support/messages", append(append([]byte{}, pngBytes...), make([]byte, service.MaxPhotoBytes)...)); w.Code != 413 {
		t.Errorf("over 5 MB: %d", w.Code)
	}
	if w := upload(e.user, "/support/messages", []byte("plain text")); w.Code != 400 {
		t.Errorf("not an image: %d", w.Code)
	}
	if w := upload(e.admin, fmt.Sprintf("/admin/support/threads/%d/messages", thread), pngBytes); w.Code != 201 {
		t.Errorf("admin photo upload: %d", w.Code)
	}
}

func TestSupport_NeverLogsMessages(t *testing.T) {
	logs := &lockedBuffer{}
	prev := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(logs, &slog.HandlerOptions{Level: slog.LevelDebug})))
	t.Cleanup(func() { slog.SetDefault(prev) })

	e := newSupportEnv()
	e.tg.linked[e.user], e.tg.err = true, errors.New("bot down")
	e.push.err = errors.New("push down")
	secret := "секретный-текст-77"
	e.write(t, e.user, 0, fakeCardText)
	e.write(t, e.user, 0, secret)
	thread := e.mine(t, e.user, 0).ThreadID
	e.write(t, e.admin, thread, secret+" ответ")
	e.as(e.user, "POST", "/support/messages", `{"body":"`+strings.Repeat("x", 2000)+secret+`"}`)
	e.svc.Wait()
	out := logs.String()
	if !strings.Contains(out, "telegram notification failed") || !strings.Contains(out, "push failed") {
		t.Fatalf("expected the notification failures in the log: %q", out)
	}
	for _, s := range []string{secret, "8600", "1234 5678", "карта"} {
		if strings.Contains(out, s) {
			t.Errorf("the log contains %q", s)
		}
	}
}

// Through the real router: 20 messages per 10 minutes per user, then 429; reading is not limited,
// and the purchase chat's limit is a separate one.
func TestSupportRoutes_RateLimit(t *testing.T) {
	gin.SetMode(gin.TestMode)
	e := newSupportEnv()
	tokens := auth.NewTokenManager(strings.Repeat("k", 32), "test", time.Minute, time.Hour)
	r := NewRouter(RouterDeps{
		CORSOrigins: []string{"http://localhost"}, Tokens: tokens, Ctx: context.Background(),
		Support:    NewSupportHandler(e.svc),
		UserStatus: activeUsers{e.user: domain.RoleUser, e.other: domain.RoleUser, e.admin: domain.RoleAdmin},
	})
	send := func(who uuid.UUID, method, path, body string) int {
		w := httptest.NewRecorder()
		req := httptest.NewRequest(method, path, bytes.NewBufferString(body))
		req.Header.Set("Content-Type", "application/json")
		pair, err := tokens.IssuePair(who)
		if err != nil {
			t.Fatal(err)
		}
		req.Header.Set("Authorization", "Bearer "+pair.AccessToken)
		r.ServeHTTP(w, req)
		return w.Code
	}
	for i := range supportChatLimit {
		if c := send(e.user, "POST", "/api/support/messages", `{"body":"привет"}`); c != 201 {
			t.Fatalf("message %d: %d", i+1, c)
		}
	}
	if c := send(e.user, "POST", "/api/support/messages", `{"body":"привет"}`); c != 429 {
		t.Errorf("message %d: %d, want 429", supportChatLimit+1, c)
	}
	if c := send(e.user, "GET", "/api/support/messages", ""); c != 200 {
		t.Errorf("reading: %d", c)
	}
	if c := send(e.other, "POST", "/api/support/messages", `{"body":"привет"}`); c != 201 {
		t.Errorf("another user is not limited by it: %d", c)
	}
	if c := send(e.user, "GET", "/api/admin/support/threads", ""); c != 403 {
		t.Errorf("admin list as a user: %d", c)
	}
	if c := send(e.admin, "GET", "/api/admin/support/threads", ""); c != 200 {
		t.Errorf("admin list: %d", c)
	}
	if c := send(e.user, "GET", "/api/support/messages", ""); c == 401 {
		t.Error("needs a login")
	}
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest("GET", "/api/support/messages", nil))
	if w.Code != 401 {
		t.Errorf("without login: %d", w.Code)
	}
}

// The bug report "admin replies show only after a reload": reading after the user's own message
// must bring the admin's reply (ids ascending, admin messages included).
func TestSupport_UserSeesTheAdminReplyAfterTheirMessage(t *testing.T) {
	e := newSupportEnv()
	mine := e.write(t, e.user, 0, "Где мои фото?")
	thread := e.threads(t, "")[0].ID // the admin replies in the thread from the list
	reply := e.write(t, e.admin, thread, "Уже начислили")
	second := e.write(t, e.admin, thread, "Проверьте, пожалуйста")

	got := e.mine(t, e.user, mine.ID)
	if got.ThreadID != thread {
		t.Fatalf("the user reads thread %d, the admin wrote to %d", got.ThreadID, thread)
	}
	if len(got.Messages) != 2 || got.Messages[0].ID != reply.ID || got.Messages[1].ID != second.ID {
		t.Fatalf("after %d: %+v", mine.ID, got.Messages)
	}
	if got.Messages[0].Author != "admin" || got.Messages[0].Mine || *got.Messages[0].Body != "Уже начислили" {
		t.Errorf("reply %+v", got.Messages[0])
	}
	if latest := e.mine(t, e.user, second.ID); len(latest.Messages) != 0 {
		t.Errorf("after the newest: %+v", latest.Messages)
	}
}
