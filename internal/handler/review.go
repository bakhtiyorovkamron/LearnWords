package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"learnwords/internal/service"
)

type ReviewHandler struct{ svc *service.ReviewService }

func NewReviewHandler(svc *service.ReviewService) *ReviewHandler { return &ReviewHandler{svc: svc} }

// Due handles GET /api/review/due[?folder_id=<uuid>|none][&limit=10|20|50|all].
// limit caps how many due cards are returned (session size); an unknown/missing value falls
// back to service.DefaultSessionSize. "total" in the response is the real due count, uncapped.
func (h *ReviewHandler) Due(c *gin.Context) {
	folder, ok := parseFolderFilter(c)
	if !ok {
		return
	}
	cards, total, err := h.svc.Due(c.Request.Context(), userID(c), folder, c.Query("limit"))
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"cards": cards, "total": total})
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
