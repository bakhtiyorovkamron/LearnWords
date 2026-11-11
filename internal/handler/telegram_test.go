package handler

import (
	"bytes"
	"context"
	"learnwords/internal/domain"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"learnwords/internal/service"
)

type nopTelegramRepo struct{ binds int }

func (r *nopTelegramRepo) ReplaceLinkCode(context.Context, uuid.UUID, string, time.Time) error {
	return nil
}
func (r *nopTelegramRepo) BindTelegram(context.Context, string, int64, *string, time.Time, int) (bool, int, error) {
	r.binds++
	return true, 0, nil
}

func (r *nopTelegramRepo) UsedCodeChat(context.Context, string) (int64, bool, error) {
	return 0, false, nil
}
func (r *nopTelegramRepo) ChatID(context.Context, uuid.UUID) (int64, bool, error) {
	return 0, false, nil
}
func (r *nopTelegramRepo) MarkBlocked(context.Context, uuid.UUID) error            { return nil }
func (r *nopTelegramRepo) ClearChatBlocked(context.Context, int64) error           { return nil }
func (r *nopTelegramRepo) SetChatLang(context.Context, int64, string) error        { return nil }
func (r *nopTelegramRepo) SetNotifications(context.Context, uuid.UUID, bool) error { return nil }
func (r *nopTelegramRepo) SetChatNotifications(context.Context, int64, bool) (bool, error) {
	return false, nil
}

type countingBot struct{ sent int }

func (b *countingBot) SendMessage(context.Context, int64, string, *domain.TelegramButton) error {
	b.sent++
	return nil
}
func (b *countingBot) SetWebhook(context.Context, string, string) error { return nil }

const hookSecret = "hook-secret-123"

func telegramRouter(bot service.TelegramBot, repo service.TelegramRepository, secret string) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	h := NewTelegramHandler(service.NewTelegramService(repo, bot, "yodla_bot"), secret)
	r.POST("/telegram/webhook", h.Webhook)
	authed := r.Group("", func(c *gin.Context) { c.Set(userIDKey, uuid.New()) })
	authed.POST("/me/telegram/link", h.Link)
	return r
}

func postUpdate(r *gin.Engine, secret, body string) *httptest.ResponseRecorder {
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/telegram/webhook", bytes.NewBufferString(body))
	if secret != "" {
		req.Header.Set("X-Telegram-Bot-Api-Secret-Token", secret)
	}
	r.ServeHTTP(w, req)
	return w
}

const privateStart = `{"update_id":1,"message":{"text":"/start YL-ABC234","chat":{"id":5,"type":"private"},"from":{"username":"a","language_code":"en"}}}`

func TestTelegramWebhook_WrongSecretIs401(t *testing.T) {
	repo, bot := &nopTelegramRepo{}, &countingBot{}
	r := telegramRouter(bot, repo, hookSecret)
	for _, s := range []string{"", "wrong", hookSecret + "x"} {
		if w := postUpdate(r, s, privateStart); w.Code != http.StatusUnauthorized {
			t.Errorf("secret %q: status %d, want 401", s, w.Code)
		}
	}
	if repo.binds != 0 || bot.sent != 0 {
		t.Error("an unauthorized update was handled")
	}
}

func TestTelegramWebhook_NoSecretConfiguredRejectsEverything(t *testing.T) {
	r := telegramRouter(&countingBot{}, &nopTelegramRepo{}, "")
	if w := postUpdate(r, "", privateStart); w.Code != http.StatusUnauthorized {
		t.Errorf("status %d", w.Code)
	}
}

func TestTelegramWebhook_PrivateStartIsHandled(t *testing.T) {
	repo, bot := &nopTelegramRepo{}, &countingBot{}
	w := postUpdate(telegramRouter(bot, repo, hookSecret), hookSecret, privateStart)
	if w.Code != http.StatusOK || repo.binds != 1 || bot.sent != 1 {
		t.Errorf("status=%d binds=%d sent=%d", w.Code, repo.binds, bot.sent)
	}
}

func TestTelegramWebhook_IgnoresNonPrivateChats(t *testing.T) {
	repo, bot := &nopTelegramRepo{}, &countingBot{}
	r := telegramRouter(bot, repo, hookSecret)
	for _, typ := range []string{"group", "supergroup", "channel"} {
		body := `{"update_id":1,"message":{"text":"/start YL-ABC234","chat":{"id":-100,"type":"` + typ + `"}}}`
		if w := postUpdate(r, hookSecret, body); w.Code != http.StatusOK {
			t.Errorf("%s: status %d, want 200", typ, w.Code)
		}
	}
	if repo.binds != 0 || bot.sent != 0 {
		t.Errorf("binds=%d sent=%d", repo.binds, bot.sent)
	}
}

func TestTelegramWebhook_GarbageIs200(t *testing.T) {
	// Telegram resends on anything but 200: a body we cannot read is acknowledged and dropped.
	repo := &nopTelegramRepo{}
	if w := postUpdate(telegramRouter(&countingBot{}, repo, hookSecret), hookSecret, `{not json`); w.Code != http.StatusOK || repo.binds != 0 {
		t.Errorf("status=%d binds=%d", w.Code, repo.binds)
	}
}

func TestTelegram_UnavailableWithoutBot(t *testing.T) {
	r := telegramRouter(nil, &nopTelegramRepo{}, hookSecret)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodPost, "/me/telegram/link", nil))
	if w.Code != http.StatusServiceUnavailable || !bytes.Contains(w.Body.Bytes(), []byte(`"code":"telegram_unavailable"`)) {
		t.Errorf("link: %d %s", w.Code, w.Body)
	}
	if w := postUpdate(r, hookSecret, privateStart); w.Code != http.StatusServiceUnavailable {
		t.Errorf("webhook: %d", w.Code)
	}
}

func TestTelegram_LinkReturnsURLAndExpiry(t *testing.T) {
	w := httptest.NewRecorder()
	telegramRouter(&countingBot{}, &nopTelegramRepo{}, hookSecret).ServeHTTP(w, httptest.NewRequest(http.MethodPost, "/me/telegram/link", nil))
	if w.Code != http.StatusOK || !bytes.Contains(w.Body.Bytes(), []byte(`"url":"https://t.me/yodla_bot?start=YL-`)) ||
		!bytes.Contains(w.Body.Bytes(), []byte(`"expires_at":`)) || bytes.Contains(w.Body.Bytes(), []byte(`"code"`)) {
		t.Errorf("%d %s", w.Code, w.Body)
	}
}
