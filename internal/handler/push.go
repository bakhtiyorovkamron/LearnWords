package handler

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"learnwords/internal/service"
)

type PushHandler struct{ svc *service.PushService }

func NewPushHandler(svc *service.PushService) *PushHandler { return &PushHandler{svc: svc} }

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

// maxPushUsers caps the "users" target.
const maxPushUsers = 200

// AdminSend handles POST /api/admin/push {target: "me"|"all"|"users", user_ids?: [...], title, body}
// → {sent, failed, removed, users}. "me" is the calling admin; "users" takes 1-200 user ids (ids that
// do not exist are ignored). There is no url: a tap always opens the cards page.
func (h *PushHandler) AdminSend(c *gin.Context) {
	var req struct {
		Target  string   `json:"target"`
		UserIDs []string `json:"user_ids"`
		Title   string   `json:"title"`
		Body    string   `json:"body"`
	}
	if !bindSmallJSON(c, &req) {
		return
	}
	var target service.PushTarget
	switch req.Target {
	case "me":
		target.UserIDs = []uuid.UUID{userID(c)}
	case "all":
		target.All = true
	case "users":
		if len(req.UserIDs) < 1 || len(req.UserIDs) > maxPushUsers {
			badRequest(c, "user_ids must hold 1-200 user ids")
			return
		}
		seen := map[uuid.UUID]bool{}
		for _, raw := range req.UserIDs {
			id, err := uuid.Parse(raw)
			if err != nil {
				badRequest(c, "user_ids must be valid user ids")
				return
			}
			if !seen[id] {
				seen[id] = true
				target.UserIDs = append(target.UserIDs, id)
			}
		}
	default:
		badRequest(c, `target must be "me", "all" or "users"`)
		return
	}
	res, err := h.svc.SendTo(c.Request.Context(), target, req.Title, req.Body)
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}
