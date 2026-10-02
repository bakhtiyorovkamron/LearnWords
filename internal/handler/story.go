package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"learnwords/internal/service"
)

type StoryHandler struct{ svc *service.StoryService }

func NewStoryHandler(svc *service.StoryService) *StoryHandler { return &StoryHandler{svc: svc} }

// Today handles GET /api/stories/today → {story|null, words_today, genres}.
func (h *StoryHandler) Today(c *gin.Context) {
	ctx := c.Request.Context()
	words, err := h.svc.TodayWords(ctx, userID(c))
	if err != nil {
		writeError(c, err)
		return
	}
	resp := gin.H{"story": nil, "words_today": words, "genres": service.StoryGenres}
	if st, err := h.svc.ByDate(ctx, userID(c), ""); err == nil {
		resp["story"] = st
	}
	c.JSON(http.StatusOK, resp)
}

// Generate handles POST /api/stories/generate {"genre"?} → story, or 422 if no words today.
func (h *StoryHandler) Generate(c *gin.Context) {
	var req struct {
		Genre string `json:"genre"`
	}
	_ = c.ShouldBindJSON(&req)
	st, err := h.svc.GenerateDailyStory(c.Request.Context(), userID(c), req.Genre)
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

// List handles GET /api/stories → archive.
func (h *StoryHandler) List(c *gin.Context) {
	list, err := h.svc.List(c.Request.Context(), userID(c))
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"stories": list})
}

// ByDate handles GET /api/stories/:date.
func (h *StoryHandler) ByDate(c *gin.Context) {
	st, err := h.svc.ByDate(c.Request.Context(), userID(c), c.Param("date"))
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, st)
}
