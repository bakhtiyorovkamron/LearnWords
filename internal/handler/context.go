package handler

import (
	"errors"
	"io"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"

	"learnwords/internal/service"
)

type ContextHandler struct{ svc *service.ContextService }

func NewContextHandler(svc *service.ContextService) *ContextHandler { return &ContextHandler{svc: svc} }

type createContextJSON struct {
	Text     string `json:"text" binding:"required"`
	Language string `json:"language"`
}

// Create accepts either JSON {"text","language"} or multipart/form-data with
// fields "image" (file), "text" (optional), "language" (optional).
func (h *ContextHandler) Create(c *gin.Context) {
	in := service.CreateContextInput{}

	if strings.HasPrefix(c.ContentType(), "multipart/form-data") {
		in.Text = c.PostForm("text")
		in.Language = c.PostForm("language")
		fh, err := c.FormFile("image")
		switch {
		case err == nil:
			if fh.Size > service.MaxImageSize {
				badRequest(c, "image too large (max 10MB)")
				return
			}
			f, err := fh.Open()
			if err != nil {
				badRequest(c, "cannot read image")
				return
			}
			defer f.Close()
			if in.Image, err = io.ReadAll(io.LimitReader(f, service.MaxImageSize+1)); err != nil {
				badRequest(c, "cannot read image")
				return
			}
		case !errors.Is(err, http.ErrMissingFile):
			badRequest(c, "invalid multipart form")
			return
		}
	} else {
		var req createContextJSON
		if err := c.ShouldBindJSON(&req); err != nil {
			badRequest(c, err.Error())
			return
		}
		in.Text, in.Language = req.Text, req.Language
	}

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
