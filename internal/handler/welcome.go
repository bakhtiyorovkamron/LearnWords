package handler

import (
	"context"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

// LearningLanguageChooser is the /welcome question of an account created by Telegram
// (service.LearningLanguageService).
type LearningLanguageChooser interface {
	Choose(ctx context.Context, userID uuid.UUID, lang string) error
}

type WelcomeHandler struct{ svc LearningLanguageChooser }

func NewWelcomeHandler(svc LearningLanguageChooser) *WelcomeHandler { return &WelcomeHandler{svc: svc} }

// SetLearningLanguage handles PUT /api/me/learning-language {"learning_language": "de"|"en"|"fr"|"ko"}
// → 204, and the starter folder in that language. Only while /api/me says needs_language (an account
// created by Telegram): 409 language_chosen after that; 400 for an unknown language.
func (h *WelcomeHandler) SetLearningLanguage(c *gin.Context) {
	var req struct {
		LearningLanguage string `json:"learning_language"`
	}
	if !bindSmallJSON(c, &req) {
		return
	}
	if err := h.svc.Choose(c.Request.Context(), userID(c), req.LearningLanguage); err != nil {
		writeError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}
