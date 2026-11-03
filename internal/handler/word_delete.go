package handler

import (
	"context"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"learnwords/internal/domain"
)

type WordDeleter interface {
	DeleteWords(ctx context.Context, userID uuid.UUID, ids []uuid.UUID) (int, error)
}

type WordDeleteHandler struct{ store WordDeleter }

func NewWordDeleteHandler(store WordDeleter) *WordDeleteHandler {
	return &WordDeleteHandler{store: store}
}

// Delete handles POST /api/words/delete {"word_ids": [...]}: one or many (up to
// domain.MaxDeleteWords). Ids that are not the user's or already gone are skipped, so the
// answer counts only the words actually removed.
func (h *WordDeleteHandler) Delete(c *gin.Context) {
	var req struct {
		WordIDs []uuid.UUID `json:"word_ids"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequest(c, "invalid JSON body")
		return
	}
	if len(req.WordIDs) == 0 || len(req.WordIDs) > domain.MaxDeleteWords {
		badRequest(c, "word_ids must contain 1-500 ids")
		return
	}
	seen := make(map[uuid.UUID]bool, len(req.WordIDs))
	ids := make([]uuid.UUID, 0, len(req.WordIDs))
	for _, id := range req.WordIDs {
		if !seen[id] {
			seen[id] = true
			ids = append(ids, id)
		}
	}
	n, err := h.store.DeleteWords(c.Request.Context(), userID(c), ids)
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, domain.DeleteResult{Deleted: n})
}
