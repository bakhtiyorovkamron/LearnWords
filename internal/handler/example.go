package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

type generateExampleRequest struct {
	Word        string `json:"word" binding:"required,max=100"`
	Translation string `json:"translation" binding:"required,max=500"`
}

// GenerateExample handles POST /api/words/generate-example {"word","translation"}.
// It only returns the generated example; the client puts it into the form and saves it with the word.
func (h *ContextHandler) GenerateExample(c *gin.Context) {
	var req generateExampleRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequest(c, "word and translation are required")
		return
	}
	ex, err := h.svc.GenerateExample(c.Request.Context(), req.Word, req.Translation)
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"example_sentence":    ex.SentenceWithGap,
		"example_translation": ex.Translation,
		"full_sentence":       ex.FullSentence,
	})
}
