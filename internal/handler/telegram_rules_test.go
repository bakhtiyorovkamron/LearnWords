package handler

import (
	"context"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"learnwords/internal/domain"
	"learnwords/internal/service"
)

// fakeRulesRepo keeps the rules in memory.
type fakeRulesRepo struct {
	mu    sync.Mutex
	rules map[string]*domain.TelegramRule
	chat  map[uuid.UUID]service.RuleRecipient
}

func newFakeRulesRepo() *fakeRulesRepo {
	r := &fakeRulesRepo{rules: map[string]*domain.TelegramRule{}, chat: map[uuid.UUID]service.RuleRecipient{}}
	for _, d := range domain.RuleDefs {
		rule := &domain.TelegramRule{Key: d.Key, Text: domain.BroadcastText{RU: "Слов: {count}"}, Placeholders: d.Placeholders}
		if d.Daily {
			at := "19:00"
			rule.SendAt = &at
		}
		r.rules[d.Key] = rule
	}
	return r
}

func (r *fakeRulesRepo) Rules(context.Context) ([]domain.TelegramRule, error) {
	var out []domain.TelegramRule
	for _, d := range domain.RuleDefs {
		out = append(out, *r.rules[d.Key])
	}
	return out, nil
}
func (r *fakeRulesRepo) Rule(_ context.Context, key string) (domain.TelegramRule, error) {
	if x := r.rules[key]; x != nil {
		return *x, nil
	}
	return domain.TelegramRule{}, domain.ErrNotFound
}
func (r *fakeRulesRepo) SaveRule(_ context.Context, rule domain.TelegramRule) (domain.TelegramRule, error) {
	rule.Placeholders = r.rules[rule.Key].Placeholders
	r.rules[rule.Key] = &rule
	return rule, nil
}
func (r *fakeRulesRepo) ClaimRun(context.Context, string, time.Time) (bool, error) { return false, nil }
func (r *fakeRulesRepo) ReleaseRun(context.Context, string, time.Time) error       { return nil }
func (r *fakeRulesRepo) CountRuleAudience(context.Context, string, service.RuleDay) (int, error) {
	return 42, nil
}
func (r *fakeRulesRepo) CreateRuleBroadcast(context.Context, domain.TelegramRule, service.RuleDay) (*domain.TelegramBroadcast, error) {
	return nil, nil
}
func (r *fakeRulesRepo) Recipient(_ context.Context, u uuid.UUID) (service.RuleRecipient, bool, error) {
	x, ok := r.chat[u]
	return x, ok, nil
}
func (r *fakeRulesRepo) MarkBlocked(context.Context, uuid.UUID) error { return nil }

type rulesBot struct {
	countingBot
	texts []string
}

func (b *rulesBot) SendMessage(_ context.Context, _ int64, text string, _ *domain.TelegramButton) error {
	b.texts = append(b.texts, text)
	return nil
}

func rulesRouter(repo *fakeRulesRepo, bot service.TelegramBot, admin uuid.UUID) *gin.Engine {
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
	h := NewTelegramRulesHandler(service.NewTelegramRulesService(repo, bot, bot != nil, time.UTC, nil))
	g := r.Group("/admin", RequireAdmin())
	g.GET("/telegram/rules", h.List)
	g.PUT("/telegram/rules/:key", h.Update)
	g.GET("/telegram/rules/:key/preview", h.Preview)
	g.POST("/telegram/rules/:key/test", h.Test)
	return r
}

func TestTelegramRules_ListUpdatePreviewTest(t *testing.T) {
	admin, user := uuid.New(), uuid.New()
	repo, bot := newFakeRulesRepo(), &rulesBot{}
	r := rulesRouter(repo, bot, admin)

	if w := callAs(r, user, "GET", "/admin/telegram/rules", ""); w.Code != 403 {
		t.Errorf("a non-admin: %d", w.Code)
	}
	w := callAs(r, admin, "GET", "/admin/telegram/rules", "")
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"key":"review_reminder"`) || !strings.Contains(w.Body.String(), `"placeholders":["name","count"]`) ||
		!strings.Contains(w.Body.String(), `"last_run_on":null`) {
		t.Errorf("list: %d %s", w.Code, w.Body)
	}

	put := func(key, body string) (int, string) {
		w := callAs(r, admin, "PUT", "/admin/telegram/rules/"+key, body)
		return w.Code, w.Body.String()
	}
	code, body := put("review_reminder", `{"enabled":true,"send_at":"20:15","text":{"ru":" Слов: {count} ","uz":"","en":"Words: {count}"},"button":{"text":"Open","url":"https://yodla.fun"}}`)
	if code != 200 || !strings.Contains(body, `"enabled":true`) || !strings.Contains(body, `"send_at":"20:15"`) || !strings.Contains(body, `"ru":"Слов: {count}"`) {
		t.Errorf("save: %d %s", code, body)
	}
	if !repo.rules["review_reminder"].Enabled || repo.rules["review_reminder"].Button == nil {
		t.Error("not stored")
	}
	for name, c := range map[string]struct{ key, body, code, field string }{
		"unknown placeholder": {"review_reminder", `{"enabled":true,"send_at":"19:00","text":{"ru":"{oops}"}}`, "invalid_placeholder", "ru"},
		"quiet hours":         {"comeback", `{"enabled":true,"send_at":"23:00","text":{"ru":"x"}}`, "invalid_send_at", "send_at"},
		"early":               {"comeback", `{"enabled":true,"send_at":"07:00","text":{"ru":"x"}}`, "invalid_send_at", "send_at"},
		"no time":             {"comeback", `{"enabled":true,"text":{"ru":"x"}}`, "invalid_send_at", "send_at"},
		"time on an event":    {"purchase_paid", `{"enabled":true,"send_at":"10:00","text":{"ru":"x"}}`, "invalid_send_at", "send_at"},
		"empty text":          {"purchase_paid", `{"enabled":true,"text":{"ru":""}}`, "invalid_text", "ru"},
		"count in a purchase": {"purchase_paid", `{"enabled":true,"text":{"ru":"{count}"}}`, "invalid_placeholder", "ru"},
		"http button":         {"purchase_paid", `{"enabled":true,"text":{"ru":"x"},"button":{"text":"a","url":"http://x.co"}}`, "invalid_button", "button"},
	} {
		code, body := put(c.key, c.body)
		if code != 400 || !strings.Contains(body, `"code":"`+c.code+`"`) || !strings.Contains(body, `"field":"`+c.field+`"`) {
			t.Errorf("%s: %d %s", name, code, body)
		}
	}
	if code, _ := put("nope", `{"enabled":true,"text":{"ru":"x"}}`); code != 404 {
		t.Errorf("unknown key: %d", code)
	}
	if code, _ := put("comeback", `x`); code != 400 {
		t.Errorf("bad body: %d", code)
	}

	if w := callAs(r, admin, "GET", "/admin/telegram/rules/review_reminder/preview", ""); w.Code != 200 || w.Body.String() != `{"recipients":42}` {
		t.Errorf("preview: %d %s", w.Code, w.Body)
	}
	if w := callAs(r, admin, "GET", "/admin/telegram/rules/purchase_paid/preview", ""); w.Code != 400 {
		t.Errorf("preview of an event rule: %d", w.Code)
	}

	if w := callAs(r, admin, "POST", "/admin/telegram/rules/review_reminder/test", ""); w.Code != 400 || !strings.Contains(w.Body.String(), `"telegram_not_linked"`) {
		t.Errorf("test without Telegram: %d %s", w.Code, w.Body)
	}
	repo.chat[admin] = service.RuleRecipient{ChatID: 5, Lang: "ru"}
	if w := callAs(r, admin, "POST", "/admin/telegram/rules/review_reminder/test", ""); w.Code != 204 || len(bot.texts) != 1 || bot.texts[0] != "Слов: 12" {
		t.Errorf("test: %d %v", w.Code, bot.texts)
	}
	off := rulesRouter(repo, nil, admin)
	if w := callAs(off, admin, "POST", "/admin/telegram/rules/review_reminder/test", ""); w.Code != 503 {
		t.Errorf("test without a bot: %d", w.Code)
	}
}

type fakeEvents struct {
	mu    sync.Mutex
	sends []string // "<rule> <code>"
	taken bool     // Telegram took the message
}

func (f *fakeEvents) SendPurchaseEvent(_ context.Context, key string, p domain.PurchaseRequest) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.sends = append(f.sends, key+" "+p.Code)
	return f.taken
}

func TestPurchaseDecisions_OneMessage_TelegramRuleReplacesThePush(t *testing.T) {
	e := newPurchaseEnv(cardAndTelegram)
	ev := &fakeEvents{taken: true}
	e.svc.WithEvents(ev)

	paid := e.buy(t, e.user, "photo_35")
	if w := e.as(e.admin, "POST", "/admin/purchases/"+paid+"/approve", ""); w.Code != 200 {
		t.Fatalf("approve: %d %s", w.Code, w.Body)
	}
	e.svc.Wait()
	if len(ev.sends) != 1 || !strings.HasPrefix(ev.sends[0], "purchase_paid ") {
		t.Errorf("events %v", ev.sends)
	}
	if n := len(creditedPushes(e)); n != 0 {
		t.Errorf("the buyer got the push too (%d): one message per decision", n)
	}

	// The rule is off or Telegram did not take it: the push as before.
	ev.taken = false
	paid2 := e.buy(t, e.user, "photo_35")
	e.as(e.admin, "POST", "/admin/purchases/"+paid2+"/approve", "")
	e.svc.Wait()
	if pushes := creditedPushes(e); len(pushes) != 1 {
		t.Errorf("fallback push %+v", pushes)
	}

	// A rejection: only the rule's text, never a push.
	rej := e.buy(t, e.user, "photo_35")
	if w := e.as(e.admin, "POST", "/admin/purchases/"+rej+"/reject", ""); w.Code != 200 {
		t.Fatalf("reject: %d %s", w.Code, w.Body)
	}
	e.svc.Wait()
	if len(ev.sends) != 3 || !strings.HasPrefix(ev.sends[2], "purchase_rejected ") || len(creditedPushes(e)) != 1 {
		t.Errorf("events %v pushes %d", ev.sends, len(creditedPushes(e)))
	}
}

// creditedPushes: the buyer's "photos added" pushes (the admins get "new request" ones too).
func creditedPushes(e purchaseEnv) []sentPush {
	var out []sentPush
	for _, p := range e.push.all() {
		if p.title == "Фото начислены" {
			out = append(out, p)
		}
	}
	return out
}

type panickyEvents struct{}

func (panickyEvents) SendPurchaseEvent(context.Context, string, domain.PurchaseRequest) bool {
	return false
}

func TestPurchaseDecisions_AFailedTelegramSendNeverFailsTheApproval(t *testing.T) {
	e := newPurchaseEnv(cardAndTelegram)
	e.svc.WithEvents(panickyEvents{}) // Telegram says "not sent" (a 403, a timeout…)
	id := e.buy(t, e.user, "photo_35")
	if w := e.as(e.admin, "POST", "/admin/purchases/"+id+"/approve", ""); w.Code != 200 {
		t.Fatalf("approve: %d %s", w.Code, w.Body)
	}
	e.svc.Wait()
	if n := e.photoCredits(t, e.user); n != 35 {
		t.Errorf("credits %d, want 35", n)
	}
}
