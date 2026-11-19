package handler

import (
	"context"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

type WordRepeater interface {
	SetRepeat(ctx context.Context, userID, wordID uuid.UUID, marked bool) (bool, error)
}

type WordRepeatHandler struct{ svc WordRepeater }

func NewWordRepeatHandler(svc WordRepeater) *WordRepeatHandler { return &WordRepeatHandler{svc: svc} }

// Repeat handles POST /api/words/repeat {"word_id": "<uuid>", "marked": bool} → {"marked": bool}:
// the deck's "review later" mark. Marking makes the word due today and puts it first; unmarking
// undoes exactly that. Both are idempotent. Another user's word → 404.
func (h *WordRepeatHandler) Repeat(c *gin.Context) {
	var req struct {
		WordID *uuid.UUID `json:"word_id"`
		Marked *bool      `json:"marked"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequest(c, "invalid JSON body")
		return
	}
	if req.WordID == nil || req.Marked == nil {
		badRequest(c, "word_id (uuid) and marked (bool) are required")
		return
	}
	marked, err := h.svc.SetRepeat(c.Request.Context(), userID(c), *req.WordID, *req.Marked)
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"marked": marked})
}
