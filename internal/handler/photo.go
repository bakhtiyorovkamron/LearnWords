package handler

import (
	"errors"
	"io"
	"net/http"

	"github.com/gin-gonic/gin"

	"learnwords/internal/domain"
	"learnwords/internal/service"
)

type PhotoHandler struct{ svc *service.PhotoImportService }

func NewPhotoHandler(svc *service.PhotoImportService) *PhotoHandler { return &PhotoHandler{svc: svc} }

// multipart framing on top of the image itself
const photoFormOverhead = 1 << 20

// Import handles POST /api/photo-import (multipart, field "image": JPEG/PNG/WebP/GIF, ≤ 5 MB)
// → {words: [{word, article, word_type, translation, full_word, already_added}], remaining}.
// The words are NOT saved: the client shows them, and the chosen ones are saved with
// POST /api/search-word/add. Costs one unit of the daily photo_import quota (403 feature_disabled,
// 429 daily_limit); the unit is given back if the AI call fails.
func (h *PhotoHandler) Import(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, service.MaxPhotoBytes+photoFormOverhead)
	fh, err := c.FormFile("image")
	if err != nil {
		var tooBig *http.MaxBytesError
		if errors.As(err, &tooBig) {
			c.AbortWithStatusJSON(http.StatusRequestEntityTooLarge, errorResponse{Error: "image is too large"})
			return
		}
		badRequest(c, `multipart field "image" is required`)
		return
	}
	if fh.Size > service.MaxPhotoBytes {
		c.AbortWithStatusJSON(http.StatusRequestEntityTooLarge, errorResponse{Error: "image is too large"})
		return
	}
	f, err := fh.Open()
	if err != nil {
		badRequest(c, "cannot read the image")
		return
	}
	defer f.Close()
	data, err := io.ReadAll(io.LimitReader(f, service.MaxPhotoBytes+1))
	if err != nil {
		badRequest(c, "cannot read the image")
		return
	}
	res, err := h.svc.Import(c.Request.Context(), userID(c), data)
	if err != nil {
		writeError(c, err)
		return
	}
	if res.Words == nil {
		res.Words = []domain.PhotoWord{}
	}
	c.JSON(http.StatusOK, res)
}
