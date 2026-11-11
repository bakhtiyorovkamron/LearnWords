package handler

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"learnwords/internal/domain"
	"learnwords/internal/service"
)

// TelegramBroadcastHandler: the admins' Telegram broadcasts.
type TelegramBroadcastHandler struct {
	svc *service.TelegramBroadcastService
}

func NewTelegramBroadcastHandler(svc *service.TelegramBroadcastService) *TelegramBroadcastHandler {
	return &TelegramBroadcastHandler{svc: svc}
}

// Audience handles GET /api/admin/telegram/audience → {linked, reachable, opted_out, blocked}.
// 503 telegram_unavailable without a bot.
func (h *TelegramBroadcastHandler) Audience(c *gin.Context) {
	a, err := h.svc.Audience(c.Request.Context())
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, a)
}

// Create handles POST /api/admin/telegram/broadcasts
// {target: "me"|"all"|"users", user_ids?: [...], text: {ru, uz?, en?}, button?: {text, url}}
// → 202 {broadcast, skipped}. 400 for bad input (code telegram_not_linked for "me" without the
// admin's Telegram), 409 broadcast_running for a second "all", 503 telegram_unavailable.
func (h *TelegramBroadcastHandler) Create(c *gin.Context) {
	var req struct {
		Target  string   `json:"target"`
		UserIDs []string `json:"user_ids"`
		Text    struct {
			RU string `json:"ru"`
			UZ string `json:"uz"`
			EN string `json:"en"`
		} `json:"text"`
		Button *domain.TelegramButton `json:"button"`
	}
	if !bindSmallJSON(c, &req) {
		return
	}
	var ids []uuid.UUID
	if len(req.UserIDs) > domain.BroadcastMaxUsers {
		badRequest(c, "user_ids must hold 1-200 user ids")
		return
	}
	for _, raw := range req.UserIDs {
		id, err := uuid.Parse(raw)
		if err != nil {
			badRequest(c, "user_ids must be valid user ids")
			return
		}
		ids = append(ids, id)
	}
	b, skipped, err := h.svc.Create(c.Request.Context(), userID(c), req.Target, ids, req.Text.RU, req.Text.UZ, req.Text.EN, req.Button)
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusAccepted, gin.H{"broadcast": b, "skipped": skipped})
}

// List handles GET /api/admin/telegram/broadcasts → {broadcasts: [the last 20, newest first]}.
func (h *TelegramBroadcastHandler) List(c *gin.Context) {
	bs, err := h.svc.List(c.Request.Context())
	if err != nil {
		writeError(c, err)
		return
	}
	if bs == nil {
		bs = []domain.TelegramBroadcast{}
	}
	c.JSON(http.StatusOK, gin.H{"broadcasts": bs})
}

// Get handles GET /api/admin/telegram/broadcasts/:id → one broadcast with live counters.
func (h *TelegramBroadcastHandler) Get(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || id <= 0 {
		badRequest(c, "invalid broadcast id")
		return
	}
	b, err := h.svc.Get(c.Request.Context(), id)
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, b)
}
