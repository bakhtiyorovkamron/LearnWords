package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"learnwords/internal/domain"
	"learnwords/internal/service"
)

type TranslationHandler struct{ svc *service.TranslationService }

func NewTranslationHandler(svc *service.TranslationService) *TranslationHandler {
	return &TranslationHandler{svc: svc}
}

const maxTranslationWordIDs = 10

// Batch handles POST /api/translations {"word_ids": ["..."], "native_language": "uz"}.
// Resolves each word's translation in native_language — cached if already seen, generated via
// AI and cached otherwise. Used by the quiz so a question's prompt and answer options are shown
// in the user's actual interface language instead of whatever language the card was created in.
func (h *TranslationHandler) Batch(c *gin.Context) {
	var req struct {
		WordIDs        []string `json:"word_ids"`
		NativeLanguage string   `json:"native_language"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequest(c, "invalid JSON body")
		return
	}
	if len(req.WordIDs) == 0 {
		badRequest(c, "word_ids is required")
		return
	}
	if len(req.WordIDs) > maxTranslationWordIDs {
		badRequest(c, "too many word_ids")
		return
	}
	ids := make([]uuid.UUID, 0, len(req.WordIDs))
	for _, s := range req.WordIDs {
		id, err := uuid.Parse(s)
		if err != nil {
			badRequest(c, "invalid word id")
			return
		}
		ids = append(ids, id)
	}
	ctx := domain.WithTranslationLang(c.Request.Context(), req.NativeLanguage)
	native := domain.TranslationLangFrom(ctx)
	result := h.svc.TranslateBatch(ctx, userID(c), ids, native)
	translations := make(map[string]service.CardTranslation, len(result))
	for id, tr := range result {
		translations[id.String()] = tr
	}
	c.JSON(http.StatusOK, gin.H{"translations": translations})
}
