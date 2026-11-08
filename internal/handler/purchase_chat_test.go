package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"mime/multipart"
	"net/http/httptest"
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

// A made-up card number (not a real card).
const fakeCardText = "моя карта 8600 1234 5678 9012"

type chatMsg struct {
	ID           int64   `json:"id"`
	Author       string  `json:"author"`
	Mine         bool    `json:"mine"`
	Body         *string `json:"body"`
	HasImage     bool    `json:"has_image"`
	Hidden       bool    `json:"hidden"`
	HiddenReason *string `json:"hidden_reason"`
	Event        *string `json:"event"`
}

type chatPage struct {
	Request struct {
		Code   string `json:"code"`
		Status string `json:"status"`
		Unread *int   `json:"unread"`
	} `json:"request"`
	Messages []chatMsg `json:"messages"`
}

func (e purchaseEnv) chatPath(who uuid.UUID, id string) string {
	if who == e.admin {
		return "/admin/purchases/" + id + "/messages"
	}
	return "/me/purchases/" + id + "/messages"
}

func (e purchaseEnv) say(t *testing.T, who uuid.UUID, id, body string) chatMsg {
	t.Helper()
	b, _ := json.Marshal(map[string]string{"body": body})
	w := e.as(who, "POST", e.chatPath(who, id), string(b))
	if w.Code != 201 {
		t.Fatalf("post as %v: %d %s", who, w.Code, w.Body)
	}
	var m chatMsg
	_ = json.Unmarshal(w.Body.Bytes(), &m)
	return m
}

func (e purchaseEnv) read(t *testing.T, who uuid.UUID, id string, after int64) chatPage {
	t.Helper()
	path := e.chatPath(who, id)
	if after > 0 {
		path += "?after=" + itoa(after)
	}
	w := e.as(who, "GET", path, "")
	if w.Code != 200 {
		t.Fatalf("read as %v: %d %s", who, w.Code, w.Body)
	}
	var p chatPage
	if err := json.Unmarshal(w.Body.Bytes(), &p); err != nil {
		t.Fatal(err)
	}
	return p
}

func itoa(n int64) string { b, _ := json.Marshal(n); return string(b) }

func (e purchaseEnv) unread(t *testing.T, id string) int {
	t.Helper()
	w := e.as(e.admin, "GET", "/admin/purchases?status=all", "")
	var out struct {
		Requests []struct {
			ID     string `json:"id"`
			Unread int    `json:"unread"`
		} `json:"requests"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &out)
	for _, r := range out.Requests {
		if r.ID == id {
			return r.Unread
		}
	}
	t.Fatalf("request %s not listed", id)
	return 0
}

func TestPurchaseChat_BuyerAndAdminTalk_UnreadAndNotifications(t *testing.T) {
	e := newPurchaseEnv(cardAndTelegram)
	id := e.buy(t, e.user, "photo_35")

	m := e.say(t, e.user, id, "  Перевёл, чек ниже  ")
	if m.Author != "buyer" || !m.Mine || m.Body == nil || *m.Body != "Перевёл, чек ниже" || m.Hidden {
		t.Fatalf("buyer's message %+v (the text is trimmed)", m)
	}
	e.say(t, e.user, id, "Код YD-0001, сумма 25 000")
	if n := e.unread(t, id); n != 2 {
		t.Errorf("unread before the admin reads = %d, want 2", n)
	}
	page := e.read(t, e.admin, id, 0)
	if len(page.Messages) != 2 || page.Messages[0].Mine || page.Request.Code != "YD-0001" {
		t.Fatalf("admin reads %+v", page)
	}
	if n := e.unread(t, id); n != 0 {
		t.Errorf("unread after reading = %d", n)
	}

	// The buyer has no Telegram: the admin's reply goes by push, without its text.
	reply := e.say(t, e.admin, id, "Спасибо, проверяю")
	e.svc.Wait()
	if reply.Author != "admin" || !reply.Mine {
		t.Errorf("admin's message %+v", reply)
	}
	pushes := e.push.all()
	last := pushes[len(pushes)-1]
	if last.to[0] != e.user || last.title != "Новое сообщение по заявке YD-0001" || last.body != "Откройте сайт, чтобы ответить." {
		t.Errorf("push %+v", last)
	}
	page = e.read(t, e.user, id, 0)
	if len(page.Messages) != 3 || page.Messages[2].Author != "admin" || page.Messages[2].Mine || !page.Messages[0].Mine {
		t.Fatalf("buyer reads %+v", page.Messages)
	}
	// Only the messages after the given id.
	if after := e.read(t, e.user, id, page.Messages[1].ID); len(after.Messages) != 1 || after.Messages[0].ID != reply.ID {
		t.Errorf("after: %+v", after.Messages)
	}

	// With Telegram linked: the bot tells the buyer, and there is no push.
	e.tg.linked[e.user] = true
	before := len(e.push.all())
	e.say(t, e.admin, id, "Всё пришло")
	e.svc.Wait()
	if sent := e.tg.all(); len(sent) != 1 || sent[0].title != "Новое сообщение по заявке YD-0001. Откройте сайт, чтобы ответить." {
		t.Errorf("telegram %+v", sent)
	}
	if len(e.push.all()) != before {
		t.Error("a buyer with Telegram also got a push")
	}
	// Telegram failing: the push is the fallback.
	e.tg.err = errors.New("bot down")
	e.say(t, e.admin, id, "Ещё одно")
	e.svc.Wait()
	if len(e.push.all()) != before+1 {
		t.Error("no push after Telegram failed")
	}
	// The buyer's own messages notify nobody.
	pushesNow, tgNow := len(e.push.all()), len(e.tg.all())
	e.say(t, e.user, id, "Ок")
	e.svc.Wait()
	if len(e.push.all()) != pushesNow || len(e.tg.all()) != tgNow {
		t.Error("a buyer's message sent a notification")
	}
}

func TestPurchaseChat_CardNumberIsHiddenFromTheOtherSide(t *testing.T) {
	e := newPurchaseEnv(cardAndTelegram)
	id := e.buy(t, e.user, "photo_35")

	m := e.say(t, e.user, id, fakeCardText)
	if !m.Hidden || m.HiddenReason == nil || *m.HiddenReason != "card_number" || m.Body != nil {
		t.Fatalf("the author's answer %+v: hidden, with the reason, and the number is not sent back", m)
	}
	// The buyer sees their own hidden message (as the warning); the admins see the text.
	own := e.read(t, e.user, id, 0).Messages
	if len(own) != 1 || !own[0].Hidden || own[0].Body != nil || !own[0].Mine {
		t.Errorf("buyer sees %+v", own)
	}
	adm := e.read(t, e.admin, id, 0).Messages
	if len(adm) != 1 || !adm[0].Hidden || adm[0].Body == nil || *adm[0].Body != fakeCardText {
		t.Errorf("admin sees %+v", adm)
	}

	// An admin's card-like message: the buyer never sees it, and is not notified about it.
	pushes := len(e.push.all())
	am := e.say(t, e.admin, id, "Переведите на 8600-1234-5678-9012")
	e.svc.Wait()
	if !am.Hidden || am.Body == nil {
		t.Errorf("the admin's own view %+v", am)
	}
	if len(e.push.all()) != pushes {
		t.Error("a hidden message notified the buyer")
	}
	for _, msg := range e.read(t, e.user, id, 0).Messages {
		if msg.Author == "admin" {
			t.Errorf("the buyer sees the admin's hidden message %+v", msg)
		}
	}
	if n := len(e.read(t, e.admin, id, 0).Messages); n != 2 {
		t.Errorf("admin sees %d messages, want 2", n)
	}
	// Short numbers are fine.
	if m := e.say(t, e.user, id, "Отправил 25000, код YD-0001"); m.Hidden {
		t.Error("25000 was hidden")
	}
}

func TestPurchaseChat_CancelledOrRejectedRequestRefusesNewMessages(t *testing.T) {
	e := newPurchaseEnv(cardAndTelegram)

	cancelled := e.buy(t, e.user, "photo_35")
	e.say(t, e.user, cancelled, "Передумал")
	if w := e.as(e.user, "DELETE", "/me/purchases/"+cancelled, ""); w.Code != 204 {
		t.Fatalf("cancel %d", w.Code)
	}
	for _, who := range []uuid.UUID{e.user, e.admin} {
		w := e.as(who, "POST", e.chatPath(who, cancelled), `{"body":"ещё"}`)
		if w.Code != 409 || !strings.Contains(w.Body.String(), `"code":"chat_closed"`) {
			t.Errorf("post to a cancelled request: %d %s", w.Code, w.Body)
		}
	}
	page := e.read(t, e.user, cancelled, 0) // the history stays readable
	if len(page.Messages) != 2 || page.Request.Status != "cancelled" {
		t.Fatalf("history %+v", page)
	}
	sys := page.Messages[1]
	if sys.Author != "system" || sys.Event == nil || *sys.Event != "cancelled" || *sys.Body != "Заявка отменена" || sys.Mine {
		t.Errorf("system line %+v", sys)
	}

	rejected := e.buy(t, e.user, "photo_35")
	if w := e.as(e.admin, "POST", "/admin/purchases/"+rejected+"/reject", ""); w.Code != 200 {
		t.Fatal(w.Code)
	}
	if w := e.as(e.user, "POST", e.chatPath(e.user, rejected), `{"body":"почему?"}`); w.Code != 409 {
		t.Errorf("post to a rejected request: %d", w.Code)
	}
	if msgs := e.read(t, e.user, rejected, 0).Messages; len(msgs) != 1 || *msgs[0].Event != "cancelled" {
		t.Errorf("rejected: %+v", msgs)
	}

	// Paid: the history is there and writing still works (e.g. "the photos did not arrive").
	paid := e.buy(t, e.user, "photo_35")
	if w := e.as(e.admin, "POST", "/admin/purchases/"+paid+"/approve", ""); w.Code != 200 {
		t.Fatal(w.Code)
	}
	msgs := e.read(t, e.user, paid, 0).Messages
	if len(msgs) != 1 || *msgs[0].Event != "paid" || *msgs[0].Body != "Оплата подтверждена, +35 фото" {
		t.Errorf("paid: %+v", msgs)
	}
	e.say(t, e.user, paid, "Спасибо!")
}

func TestPurchaseChat_OnlyTheBuyerAndAdmins(t *testing.T) {
	e := newPurchaseEnv(cardAndTelegram)
	id := e.buy(t, e.user, "photo_35")
	e.say(t, e.user, id, "привет")
	for _, c := range []struct{ method, path, body string }{
		{"GET", "/me/purchases/" + id + "/messages", ""},
		{"POST", "/me/purchases/" + id + "/messages", `{"body":"чужое"}`},
		{"GET", "/me/purchases/" + id + "/messages/1/image", ""},
		{"GET", "/me/purchases/" + uuid.NewString() + "/messages", ""},
	} {
		if w := e.as(e.other, c.method, c.path, c.body); w.Code != 404 {
			t.Errorf("another user %s %s: %d", c.method, c.path, w.Code)
		}
	}
	// A user cannot use the admin routes.
	if w := e.as(e.user, "GET", "/admin/purchases/"+id+"/messages", ""); w.Code != 403 {
		t.Errorf("admin chat as a user: %d", w.Code)
	}
}

func TestPurchaseChat_Validation(t *testing.T) {
	e := newPurchaseEnv(cardAndTelegram)
	id := e.buy(t, e.user, "photo_35")
	for name, body := range map[string]string{
		"empty":       `{"body":""}`,
		"only spaces": `{"body":"   \n "}`,
		"too long":    `{"body":"` + strings.Repeat("я", domain.MaxChatBody+1) + `"}`,
		"no body":     `{}`,
	} {
		if w := e.as(e.user, "POST", "/me/purchases/"+id+"/messages", body); w.Code != 400 {
			t.Errorf("%s: %d", name, w.Code)
		}
	}
	e.say(t, e.user, id, strings.Repeat("я", domain.MaxChatBody))
	if w := e.as(e.user, "GET", "/me/purchases/"+id+"/messages?after=-1", ""); w.Code != 400 {
		t.Errorf("after=-1: %d", w.Code)
	}
	if w := e.as(e.user, "GET", "/me/purchases/"+id+"/messages?after=x", ""); w.Code != 400 {
		t.Errorf("after=x: %d", w.Code)
	}
	// Pages of 50.
	for range 59 {
		e.say(t, e.admin, id, "ok")
	}
	first := e.read(t, e.user, id, 0).Messages
	if len(first) != 50 {
		t.Fatalf("first page %d", len(first))
	}
	if rest := e.read(t, e.user, id, first[49].ID).Messages; len(rest) != 10 {
		t.Errorf("second page %d", len(rest))
	}
}

// pngBytes: a 1×1 PNG.
var pngBytes = []byte("\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\rIDATx\x9cc\xf8\x0f\x00\x00\x01\x01\x00\x05\x18\xd8N\x00\x00\x00\x00IEND\xaeB`\x82")

func (e purchaseEnv) upload(who uuid.UUID, id, body string, image []byte) *httptest.ResponseRecorder {
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	if body != "" {
		_ = mw.WriteField("body", body)
	}
	if image != nil {
		fw, _ := mw.CreateFormFile("image", "receipt.png")
		_, _ = fw.Write(image)
	}
	_ = mw.Close()
	w := httptest.NewRecorder()
	req := httptest.NewRequest("POST", e.chatPath(who, id), &buf)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	req.Header.Set("X-Test-User", who.String())
	e.r.ServeHTTP(w, req)
	return w
}

func TestPurchaseChat_Photos(t *testing.T) {
	e := newPurchaseEnv(cardAndTelegram)
	id := e.buy(t, e.user, "photo_35")

	w := e.upload(e.user, id, "чек", pngBytes)
	if w.Code != 201 {
		t.Fatalf("upload: %d %s", w.Code, w.Body)
	}
	var m chatMsg
	_ = json.Unmarshal(w.Body.Bytes(), &m)
	if !m.HasImage || m.Body == nil || *m.Body != "чек" {
		t.Fatalf("message %+v", m)
	}
	for _, who := range []uuid.UUID{e.user, e.admin} {
		path := strings.TrimSuffix(e.chatPath(who, id), "/messages") + "/messages/" + itoa(m.ID) + "/image"
		img := e.as(who, "GET", path, "")
		if img.Code != 200 || img.Header().Get("Content-Type") != "image/png" || !bytes.Equal(img.Body.Bytes(), pngBytes) ||
			img.Header().Get("X-Content-Type-Options") != "nosniff" {
			t.Errorf("image as %v: %d %q", who, img.Code, img.Header().Get("Content-Type"))
		}
	}
	// A photo alone is a message too.
	if w := e.upload(e.user, id, "", pngBytes); w.Code != 201 {
		t.Errorf("photo only: %d", w.Code)
	}
	if w := e.upload(e.user, id, "", []byte("not an image at all")); w.Code != 400 {
		t.Errorf("not an image: %d", w.Code)
	}
	if w := e.upload(e.user, id, "", append(append([]byte{}, pngBytes...), make([]byte, service.MaxPhotoBytes)...)); w.Code != 413 ||
		!strings.Contains(w.Body.String(), `"code":"image_too_large"`) {
		t.Errorf("over 5 MB: %d %s", w.Code, w.Body)
	}
	if w := e.upload(e.user, id, "", nil); w.Code != 400 {
		t.Errorf("empty form: %d", w.Code)
	}
	// A message without a photo has no image.
	plain := e.say(t, e.user, id, "текст")
	if w := e.as(e.user, "GET", "/me/purchases/"+id+"/messages/"+itoa(plain.ID)+"/image", ""); w.Code != 404 {
		t.Errorf("no photo: %d", w.Code)
	}

	// The photo of a hidden message goes to the admins only.
	w = e.upload(e.user, id, fakeCardText, pngBytes)
	_ = json.Unmarshal(w.Body.Bytes(), &m)
	if !m.Hidden || m.HasImage {
		t.Errorf("hidden with photo, author's view %+v", m)
	}
	if w := e.as(e.user, "GET", "/me/purchases/"+id+"/messages/"+itoa(m.ID)+"/image", ""); w.Code != 404 {
		t.Errorf("hidden photo to the buyer: %d", w.Code)
	}
	if w := e.as(e.admin, "GET", "/admin/purchases/"+id+"/messages/"+itoa(m.ID)+"/image", ""); w.Code != 200 {
		t.Errorf("hidden photo to the admin: %d", w.Code)
	}
}

// lockedBuffer collects log output from the background notifications too.
type lockedBuffer struct {
	mu sync.Mutex
	b  bytes.Buffer
}

func (l *lockedBuffer) Write(p []byte) (int, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.b.Write(p)
}

func (l *lockedBuffer) String() string {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.b.String()
}

// Nothing a user wrote ends up in the logs — not when Telegram and push fail, not on errors.
func TestPurchaseChat_NeverLogsMessages(t *testing.T) {
	logs := &lockedBuffer{}
	prev := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(logs, &slog.HandlerOptions{Level: slog.LevelDebug})))
	t.Cleanup(func() { slog.SetDefault(prev) })

	e := newPurchaseEnv(cardAndTelegram)
	e.tg.linked[e.user], e.tg.err = true, errors.New("bot down")
	e.push.err = errors.New("push down")
	id := e.buy(t, e.user, "photo_35")
	secret := "секретный-текст-42"
	e.say(t, e.user, id, fakeCardText)
	e.say(t, e.user, id, secret)
	e.say(t, e.admin, id, secret+" ответ")
	e.as(e.user, "POST", "/me/purchases/"+id+"/messages", `{"body":"`+strings.Repeat("x", 2000)+secret+`"}`)
	e.svc.Wait()
	out := logs.String()
	if !strings.Contains(out, "telegram notification failed") {
		t.Fatalf("expected the notification failures in the log, got %q", out)
	}
	for _, s := range []string{secret, "8600", "1234 5678", "карта"} {
		if strings.Contains(out, s) {
			t.Errorf("the log contains %q: %s", s, out)
		}
	}
}

// Through the real router: 20 messages per 10 minutes for a buyer, then 429; the admin routes need
// the admin role.
func TestPurchaseChatRoutes_RateLimitAndAdmin(t *testing.T) {
	gin.SetMode(gin.TestMode)
	e := newPurchaseEnv(cardAndTelegram)
	tokens := auth.NewTokenManager(strings.Repeat("k", 32), "test", time.Minute, time.Hour)
	r := NewRouter(RouterDeps{
		CORSOrigins: []string{"http://localhost"}, Tokens: tokens, Ctx: context.Background(),
		Purchases:  NewPurchaseHandler(e.svc),
		UserStatus: activeUsers{e.user: domain.RoleUser, e.admin: domain.RoleAdmin},
	})
	id := e.buy(t, e.user, "photo_35")
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
	var codes []int
	for range purchaseChatLimit + 1 {
		codes = append(codes, send(e.user, "POST", "/api/me/purchases/"+id+"/messages", `{"body":"привет"}`))
	}
	for i, c := range codes[:purchaseChatLimit] {
		if c != 201 {
			t.Fatalf("message %d: %d", i+1, c)
		}
	}
	if codes[purchaseChatLimit] != 429 {
		t.Errorf("message %d: %d, want 429", purchaseChatLimit+1, codes[purchaseChatLimit])
	}
	if c := send(e.user, "GET", "/api/me/purchases/"+id+"/messages", ""); c != 200 {
		t.Errorf("reading is not limited by it: %d", c)
	}
	if c := send(e.user, "GET", "/api/admin/purchases/"+id+"/messages", ""); c != 403 {
		t.Errorf("admin chat as a user: %d", c)
	}
	if c := send(e.admin, "POST", "/api/admin/purchases/"+id+"/messages", `{"body":"ответ"}`); c != 201 {
		t.Errorf("admin post: %d", c)
	}
}
