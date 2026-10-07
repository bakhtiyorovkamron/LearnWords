package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"learnwords/internal/service"
)

type ReviewHandler struct{ svc *service.ReviewService }

func NewReviewHandler(svc *service.ReviewService) *ReviewHandler { return &ReviewHandler{svc: svc} }

// Due handles GET /api/review/due[?folder_id=<uuid>|none].
func (h *ReviewHandler) Due(c *gin.Context) {
	folder, ok := parseFolderFilter(c)
	if !ok {
		return
	}
	cards, err := h.svc.Due(c.Request.Context(), userID(c), folder)
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"cards": cards})
}

// Answer handles POST /api/review/:id/answer with {"correct": bool}.
func (h *ReviewHandler) Answer(c *gin.Context) {
	id, ok := pathUUID(c, "id")
	if !ok {
		return
	}
	var req struct {
		Correct *bool `json:"correct"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || req.Correct == nil {
		badRequest(c, "correct (bool) is required")
		return
	}
	p, err := h.svc.Answer(c.Request.Context(), userID(c), id, *req.Correct)
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, p)
}
