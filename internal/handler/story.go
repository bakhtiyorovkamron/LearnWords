package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"learnwords/internal/domain"
	"learnwords/internal/service"
)

type StoryHandler struct{ svc *service.StoryService }

func NewStoryHandler(svc *service.StoryService) *StoryHandler { return &StoryHandler{svc: svc} }

// Today handles GET /api/stories/today?native_language= → {story|null, words_today, genres}.
// native_language = the user's UI/native language: the story's translation and word glosses
// come back in it (generated + cached on first view if not already).
func (h *StoryHandler) Today(c *gin.Context) {
	ctx := domain.WithTranslationLang(c.Request.Context(), c.Query("native_language"))
	words, err := h.svc.TodayWords(ctx, userID(c))
	if err != nil {
		writeError(c, err)
		return
	}
	resp := gin.H{"story": nil, "words_today": words, "genres": service.StoryGenres}
	if st, err := h.svc.ByDate(ctx, userID(c), "", domain.TranslationLangFrom(ctx)); err == nil {
		resp["story"] = st
	}
	c.JSON(http.StatusOK, resp)
}

// Generate handles POST /api/stories/generate {"genre"?, "native_language"?} → story, or 422 if no words today.
func (h *StoryHandler) Generate(c *gin.Context) {
	var req struct {
		Genre          string `json:"genre"`
		NativeLanguage string `json:"native_language"`
	}
	_ = c.ShouldBindJSON(&req)
	ctx := domain.WithTranslationLang(c.Request.Context(), req.NativeLanguage)
	st, err := h.svc.GenerateDailyStory(ctx, userID(c), req.Genre, domain.TranslationLangFrom(ctx))
	if err != nil {
		writeError(c, err)
		return
	}
	if st == nil {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": "сегодня ещё не добавлено ни одного слова"})
		return
	}
	c.JSON(http.StatusOK, st)
}

// List handles GET /api/stories → archive (metadata + learning-language text only; the
// translation is resolved per story via ByDate when one is actually opened, not here —
// resolving it for the whole archive up front could mean hundreds of AI calls at once).
func (h *StoryHandler) List(c *gin.Context) {
	list, err := h.svc.List(c.Request.Context(), userID(c))
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"stories": list})
}

// ByDate handles GET /api/stories/:date?native_language=.
func (h *StoryHandler) ByDate(c *gin.Context) {
	ctx := domain.WithTranslationLang(c.Request.Context(), c.Query("native_language"))
	st, err := h.svc.ByDate(ctx, userID(c), c.Param("date"), domain.TranslationLangFrom(ctx))
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, st)
}
