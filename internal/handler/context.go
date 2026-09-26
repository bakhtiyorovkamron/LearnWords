package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"learnwords/internal/service"
)

type ContextHandler struct{ svc *service.ContextService }

func NewContextHandler(svc *service.ContextService) *ContextHandler { return &ContextHandler{svc: svc} }

type createContextJSON struct {
	Text     string `json:"text" binding:"required,max=2000"`
	Language string `json:"language"`
}

// Create accepts JSON {"text","language"}.
func (h *ContextHandler) Create(c *gin.Context) {
	var req createContextJSON
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequest(c, "text is required (max 2000 chars)")
		return
	}
	in := service.CreateContextInput{Text: req.Text, Language: req.Language}

	res, err := h.svc.Create(c.Request.Context(), userID(c), in)
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusCreated, res)
}

func (h *ContextHandler) List(c *gin.Context) {
	limit, offset := pagination(c)
	items, err := h.svc.List(c.Request.Context(), userID(c), limit, offset)
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items, "limit": limit, "offset": offset})
}

func (h *ContextHandler) Words(c *gin.Context) {
	id, ok := pathUUID(c, "id")
	if !ok {
		return
	}
	items, err := h.svc.Words(c.Request.Context(), userID(c), id)
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}

func (h *ContextHandler) WordCards(c *gin.Context) {
	limit, offset := pagination(c)
	items, err := h.svc.Cards(c.Request.Context(), userID(c), limit, offset)
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items, "limit": limit, "offset": offset})
}

func (h *ContextHandler) Photos(c *gin.Context) {
	id, ok := pathUUID(c, "id")
	if !ok {
		return
	}
	photos, err := h.svc.SearchPhotos(c.Request.Context(), userID(c), id, c.Query("q"))
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": photos})
}

type setPhotoRequest struct {
	URL    string `json:"url" binding:"required"`
	Credit string `json:"credit"`
}

func (h *ContextHandler) SetPhoto(c *gin.Context) {
	id, ok := pathUUID(c, "id")
	if !ok {
		return
	}
	var req setPhotoRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequest(c, "url is required")
		return
	}
	if err := h.svc.SetPhoto(c.Request.Context(), userID(c), id, req.URL, req.Credit); err != nil {
		writeError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *ContextHandler) RegenerateAudio(c *gin.Context) {
	id, ok := pathUUID(c, "id")
	if !ok {
		return
	}
	card, err := h.svc.RegenerateAudio(c.Request.Context(), userID(c), id)
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, card)
}
