package handler

import (
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"

	"learnwords/internal/domain"
	"learnwords/internal/service"
)

type ContextHandler struct{ svc *service.ContextService }

func NewContextHandler(svc *service.ContextService) *ContextHandler { return &ContextHandler{svc: svc} }

type createContextJSON struct {
	Text     string `json:"text" binding:"required,max=2000"`
	Meaning  string `json:"meaning" binding:"max=500"`
	Language string `json:"language"`
}

// readPhoto reads an optional uploaded file from the given multipart field.
func readPhoto(c *gin.Context, field string) ([]byte, error) {
	fh, err := c.FormFile(field)
	if err != nil {
		return nil, nil // no file attached
	}
	if fh.Size > service.MaxImageSize {
		return nil, fmt.Errorf("%w: image too large", domain.ErrValidation)
	}
	f, err := fh.Open()
	if err != nil {
		return nil, err
	}
	defer f.Close()
	return io.ReadAll(io.LimitReader(f, service.MaxImageSize+1))
}

// Create accepts multipart/form-data (text, meaning, language, photo) or JSON {"text","meaning","language"}.
func (h *ContextHandler) Create(c *gin.Context) {
	var in service.CreateContextInput
	if strings.HasPrefix(c.ContentType(), "multipart/") {
		in.Text = c.PostForm("text")
		in.Meaning = c.PostForm("meaning")
		in.Language = c.PostForm("language")
		if strings.TrimSpace(in.Text) == "" || len([]rune(in.Text)) > 2000 {
			badRequest(c, "text is required (max 2000 chars)")
			return
		}
		img, err := readPhoto(c, "photo")
		if err != nil {
			writeError(c, err)
			return
		}
		in.Image = img
	} else {
		var req createContextJSON
		if err := c.ShouldBindJSON(&req); err != nil {
			badRequest(c, "text is required (max 2000 chars)")
			return
		}
		in = service.CreateContextInput{Text: req.Text, Meaning: req.Meaning, Language: req.Language}
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

// SetPhoto handles PUT /api/contexts/:id/photo (multipart, field "photo").
func (h *ContextHandler) SetPhoto(c *gin.Context) {
	id, ok := pathUUID(c, "id")
	if !ok {
		return
	}
	img, err := readPhoto(c, "photo")
	if err != nil {
		writeError(c, err)
		return
	}
	if len(img) == 0 {
		badRequest(c, "photo file is required")
		return
	}
	if err := h.svc.UploadPhoto(c.Request.Context(), userID(c), id, img); err != nil {
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
