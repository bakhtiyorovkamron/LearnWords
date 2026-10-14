package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"learnwords/internal/domain"
	"learnwords/internal/service"
)

type WordCheckHandler struct {
	check *service.WordCheckService
	fixes *service.WordFixService
}

func NewWordCheckHandler(check *service.WordCheckService, fixes *service.WordFixService) *WordCheckHandler {
	return &WordCheckHandler{check: check, fixes: fixes}
}

// Check handles POST /api/words/check {"text", "native_language"} → domain.WordCheck.
// German learners only (400 otherwise); 503 when AI is not configured — the client then
// simply saves the word unchecked.
func (h *WordCheckHandler) Check(c *gin.Context) {
	var req struct {
		Text           string `json:"text"`
		NativeLanguage string `json:"native_language"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequest(c, "text is required")
		return
	}
	res, err := h.check.Check(c.Request.Context(), req.Text, req.NativeLanguage)
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

// ListFixes handles GET /api/word-fixes → the user's open suggestions ("possible mistakes in your words").
func (h *WordCheckHandler) ListFixes(c *gin.Context) {
	items, err := h.fixes.ListPending(c.Request.Context(), userID(c))
	if err != nil {
		writeError(c, err)
		return
	}
	if items == nil {
		items = []domain.WordFix{}
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}

// AcceptFix handles POST /api/word-fixes/:id/accept — the card gets the suggested text and grammar.
func (h *WordCheckHandler) AcceptFix(c *gin.Context) {
	id, ok := pathUUID(c, "id")
	if !ok {
		return
	}
	if err := h.fixes.Accept(c.Request.Context(), userID(c), id); err != nil {
		writeError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

// RejectFix handles POST /api/word-fixes/:id/reject — the card stays as it is.
func (h *WordCheckHandler) RejectFix(c *gin.Context) {
	id, ok := pathUUID(c, "id")
	if !ok {
		return
	}
	if err := h.fixes.Reject(c.Request.Context(), userID(c), id); err != nil {
		writeError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

// StartJob handles POST /api/admin/word-check — starts "check existing words" in the background.
func (h *WordCheckHandler) StartJob(c *gin.Context) {
	started, err := h.fixes.Start(c.Request.Context())
	if err != nil {
		writeError(c, err)
		return
	}
	code := http.StatusAccepted
	if !started {
		code = http.StatusConflict // already running
	}
	c.JSON(code, h.fixes.Status())
}

// JobStatus handles GET /api/admin/word-check.
func (h *WordCheckHandler) JobStatus(c *gin.Context) {
	c.JSON(http.StatusOK, h.fixes.Status())
}
