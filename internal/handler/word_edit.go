package handler

import (
	"context"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"learnwords/internal/domain"
)

type WordCardUpdater interface {
	UpdateContent(ctx context.Context, userID, id uuid.UUID, u domain.WordCardUpdate) (*domain.WordCard, error)
}

type WordEditHandler struct{ store WordCardUpdater }

func NewWordEditHandler(store WordCardUpdater) *WordEditHandler {
	return &WordEditHandler{store: store}
}

// field limits (runes)
var wordFieldLimits = map[string]int{
	"word": 100, "translation": 500, "transcription": 200,
	"example_sentence": 500, "example_translation": 500,
}

// Update handles PATCH /api/words/:id — edits word/translation/pronunciation/example.
// Only the owner's card can be changed (user_id is part of the UPDATE's WHERE);
// learning progress is kept as is.
func (h *WordEditHandler) Update(c *gin.Context) {
	id, ok := pathUUID(c, "id")
	if !ok {
		return
	}
	var u domain.WordCardUpdate
	if err := c.ShouldBindJSON(&u); err != nil {
		badRequest(c, "invalid JSON body")
		return
	}
	fields := map[string]*string{
		"word": u.Word, "translation": u.Translation, "transcription": u.Transcription,
		"example_sentence": u.ExampleSentence, "example_translation": u.ExampleTranslation,
	}
	any := false
	for name, p := range fields {
		if p == nil {
			continue
		}
		any = true
		*p = strings.TrimSpace(*p)
		if len([]rune(*p)) > wordFieldLimits[name] {
			badRequest(c, name+" is too long")
			return
		}
	}
	if !changed {
		badRequest(c, "nothing to update")
		return
	}
	if u.Word != nil && *u.Word == "" {
		badRequest(c, "word must not be empty")
		return
	}
	if u.Translation != nil && *u.Translation == "" {
		badRequest(c, "translation must not be empty")
		return
	}
	card, err := h.store.UpdateContent(c.Request.Context(), userID(c), id, u)
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, card)
}
