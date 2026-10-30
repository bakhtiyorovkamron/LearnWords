package handler

import (
	"context"
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"learnwords/internal/service"
)

type PushHandler struct {
	svc   *service.PushService
	users UserGetter
}

func NewPushHandler(svc *service.PushService, users UserGetter) *PushHandler {
	return &PushHandler{svc: svc, users: users}
}

const maxPushBody = 8 << 10

func bindSmallJSON(c *gin.Context, v any) bool {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxPushBody)
	if err := c.ShouldBindJSON(v); err != nil {
		var tooBig *http.MaxBytesError
		if errors.As(err, &tooBig) {
			c.AbortWithStatusJSON(http.StatusRequestEntityTooLarge, errorResponse{Error: "request body too large"})
		} else {
			badRequest(c, "invalid JSON body")
		}
		return false
	}
	return true
}

// PublicKey handles GET /api/push/public-key → {key}; 503 when push is not configured.
func (h *PushHandler) PublicKey(c *gin.Context) {
	key, err := h.svc.PublicKey()
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"key": key})
}

// Subscribe handles POST /api/push/subscribe {endpoint, keys: {p256dh, auth}} → 204.
func (h *PushHandler) Subscribe(c *gin.Context) {
	var req struct {
		Endpoint string `json:"endpoint"`
		Keys     struct {
			P256dh string `json:"p256dh"`
			Auth   string `json:"auth"`
		} `json:"keys"`
	}
	if !bindSmallJSON(c, &req) {
		return
	}
	if err := h.svc.Subscribe(c.Request.Context(), userID(c), req.Endpoint, req.Keys.P256dh, req.Keys.Auth, c.Request.UserAgent()); err != nil {
		writeError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

// Unsubscribe handles DELETE /api/push/subscribe {endpoint} → 204 (only the caller's own device).
func (h *PushHandler) Unsubscribe(c *gin.Context) {
	var req struct {
		Endpoint string `json:"endpoint"`
	}
	if !bindSmallJSON(c, &req) {
		return
	}
	if err := h.svc.Unsubscribe(c.Request.Context(), userID(c), req.Endpoint); err != nil {
		writeError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

// AdminStats handles GET /api/admin/push → {devices, users}.
func (h *PushHandler) AdminStats(c *gin.Context) {
	devices, users, err := h.svc.Stats(c.Request.Context())
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"devices": devices, "users": users})
}

// AdminSend handles POST /api/admin/push {target: "all"|"<user id>", title, body, url?} → {sent, failed, removed}.
func (h *PushHandler) AdminSend(c *gin.Context) {
	var req struct {
		Target string `json:"target"`
		Title  string `json:"title"`
		Body   string `json:"body"`
		URL    string `json:"url"`
	}
	if !bindSmallJSON(c, &req) {
		return
	}
	ctx := c.Request.Context()
	if req.Target != "all" {
		id, err := uuid.Parse(req.Target)
		if err != nil {
			badRequest(c, `target must be "all" or a user id`)
			return
		}
		if err := h.userExists(ctx, id); err != nil {
			writeError(c, err)
			return
		}
	}
	res, err := h.svc.SendTo(ctx, req.Target, req.Title, req.Body, req.URL)
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *PushHandler) userExists(ctx context.Context, id uuid.UUID) error {
	_, err := h.users.GetByID(ctx, id)
	return err
}
