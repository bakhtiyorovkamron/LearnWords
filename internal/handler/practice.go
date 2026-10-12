package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"learnwords/internal/service"
)

// PracticeHandler backs extra practice (POST-review training that never touches the Leitner
// schedule) — wraps the same ReviewService as ReviewHandler, just its Practice/AnswerPractice
// methods.
type PracticeHandler struct{ svc *service.ReviewService }

func NewPracticeHandler(svc *service.ReviewService) *PracticeHandler {
	return &PracticeHandler{svc: svc}
}

// Words handles GET /api/practice/words?mode=hard|random|recent&limit=10|20|50|all[&folder_id=].
func (h *PracticeHandler) Words(c *gin.Context) {
	folder, ok := parseFolderFilter(c)
	if !ok {
		return
	}
	cards, err := h.svc.Practice(c.Request.Context(), userID(c), c.Query("mode"), c.Query("limit"), folder)
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"cards": cards})
}

// Answer handles POST /api/practice/:id/answer {"correct": bool}. Unlike ReviewHandler.Answer,
// this never returns (or computes) an updated Leitner Progress — there isn't one, by design.
func (h *PracticeHandler) Answer(c *gin.Context) {
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
	if err := h.svc.AnswerPractice(c.Request.Context(), userID(c), id, *req.Correct); err != nil {
		writeError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}
