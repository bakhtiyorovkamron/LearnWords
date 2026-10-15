package handler

import (
	"context"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"learnwords/internal/domain"
)

type WordMover interface {
	MoveWords(ctx context.Context, userID uuid.UUID, ids []uuid.UUID, folder *uuid.UUID) ([]domain.WordFolder, error)
}

type WordMoveHandler struct{ store WordMover }

func NewWordMoveHandler(store WordMover) *WordMoveHandler { return &WordMoveHandler{store: store} }

// Move handles POST /api/words/move {"word_ids": [...], "folder_id": "<uuid>" | null}: one word or
// many (up to domain.MaxMoveWords), one transaction. Foreign words or folder → 404, nothing moved.
// Only the folder changes — learning progress stays. The answer carries every word's previous
// folder so the client can undo.
func (h *WordMoveHandler) Move(c *gin.Context) {
	var req struct {
		WordIDs  []uuid.UUID `json:"word_ids"`
		FolderID *uuid.UUID  `json:"folder_id"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequest(c, "invalid JSON body")
		return
	}
	if len(req.WordIDs) == 0 || len(req.WordIDs) > domain.MaxMoveWords {
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
	prev, err := h.store.MoveWords(c.Request.Context(), userID(c), ids, req.FolderID)
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, domain.MoveResult{Moved: len(prev), Previous: prev})
}
