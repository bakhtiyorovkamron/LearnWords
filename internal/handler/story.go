package handler

import (
	"errors"
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

// maxOwnStoryBody caps the request body of an own story (text ≤ 4000 + translation ≤ 8000 characters).
const maxOwnStoryBody = 64 << 10

// readOwnStory parses the body of POST/PUT /stories/own[/:id], at most maxOwnStoryBody bytes.
func readOwnStory(c *gin.Context) (domain.OwnStoryInput, bool) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxOwnStoryBody)
	var in domain.OwnStoryInput
	if err := c.ShouldBindJSON(&in); err != nil {
		var tooBig *http.MaxBytesError
		if errors.As(err, &tooBig) {
			c.AbortWithStatusJSON(http.StatusRequestEntityTooLarge, errorResponse{Error: "request body too large"})
		} else {
			badRequest(c, "invalid JSON body")
		}
		return in, false
	}
	return in, true
}

// ByID handles GET /api/stories/by-id/:id — one story (AI or own) with the text; the translation is
// resolved for the interface language (X-Native-Language).
func (h *StoryHandler) ByID(c *gin.Context) {
	id, ok := pathUUID(c, "id")
	if !ok {
		return
	}
	ctx := c.Request.Context()
	st, err := h.svc.ByID(ctx, userID(c), id, domain.TranslationLangFrom(ctx))
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, st)
}

// CreateOwn handles POST /api/stories/own {"title"?, "text", "translation_mode", "translation"?} → 201.
func (h *StoryHandler) CreateOwn(c *gin.Context) {
	in, ok := readOwnStory(c)
	if !ok {
		return
	}
	ctx := c.Request.Context()
	st, err := h.svc.CreateOwnStory(ctx, userID(c), in, domain.TranslationLangFrom(ctx))
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusCreated, st)
}

// UpdateOwn handles PUT /api/stories/own/:id. An AI story is a 404.
func (h *StoryHandler) UpdateOwn(c *gin.Context) {
	id, ok := pathUUID(c, "id")
	if !ok {
		return
	}
	in, ok := readOwnStory(c)
	if !ok {
		return
	}
	ctx := c.Request.Context()
	st, err := h.svc.UpdateOwnStory(ctx, userID(c), id, in, domain.TranslationLangFrom(ctx))
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, st)
}

// DeleteOwn handles DELETE /api/stories/own/:id → 204. An AI story is a 404.
func (h *StoryHandler) DeleteOwn(c *gin.Context) {
	id, ok := pathUUID(c, "id")
	if !ok {
		return
	}
	if err := h.svc.DeleteOwnStory(c.Request.Context(), userID(c), id); err != nil {
		writeError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}
