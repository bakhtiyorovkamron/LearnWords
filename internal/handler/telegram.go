package handler

import (
	"crypto/subtle"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"

	"github.com/gin-gonic/gin"

	"learnwords/internal/domain"
	"learnwords/internal/service"
)

const (
	telegramSecretHeader = "X-Telegram-Bot-Api-Secret-Token"
	maxTelegramUpdate    = 1 << 20
)

type TelegramHandler struct {
	svc    *service.TelegramService
	secret string // TELEGRAM_WEBHOOK_SECRET
}

func NewTelegramHandler(svc *service.TelegramService, webhookSecret string) *TelegramHandler {
	return &TelegramHandler{svc: svc, secret: webhookSecret}
}

// Link handles POST /api/me/telegram/link → {url: "https://t.me/<bot>?start=<code>", expires_at};
// 503 telegram_unavailable when the bot is not configured.
func (h *TelegramHandler) Link(c *gin.Context) {
	link, err := h.svc.CreateLink(c.Request.Context(), userID(c))
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, link)
}

// Webhook handles POST /api/telegram/webhook (called by Telegram, no user auth). The secret header
// must match TELEGRAM_WEBHOOK_SECRET (401 otherwise, also when no secret is configured). Any update
// it accepts is answered 200, whatever happened inside: Telegram resends on anything else.
func (h *TelegramHandler) Webhook(c *gin.Context) {
	if !h.svc.Enabled() {
		writeError(c, domain.ErrTelegramUnavailable)
		return
	}
	got := c.GetHeader(telegramSecretHeader)
	if h.secret == "" || subtle.ConstantTimeCompare([]byte(got), []byte(h.secret)) != 1 {
		c.AbortWithStatusJSON(http.StatusUnauthorized, errorResponse{Error: "unauthorized"})
		return
	}
	var u service.TelegramUpdate
	raw, err := io.ReadAll(io.LimitReader(c.Request.Body, maxTelegramUpdate))
	if err == nil {
		err = json.Unmarshal(raw, &u)
	}
	if err != nil {
		slog.WarnContext(c.Request.Context(), "telegram: bad update", "err", err)
		c.Status(http.StatusOK)
		return
	}
	h.svc.HandleUpdate(c.Request.Context(), u)
	c.Status(http.StatusOK)
}
