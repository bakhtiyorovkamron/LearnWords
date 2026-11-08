package handler

import (
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"learnwords/internal/domain"
	"learnwords/internal/service"
)

// chatMessageView is a chat line as one side sees it. A hidden message reaches the buyer's side
// without its text or photo (only the reason); the admins get everything.
type chatMessageView struct {
	ID           int64     `json:"id"`
	Author       string    `json:"author"` // buyer | admin | system
	Mine         bool      `json:"mine"`   // written by the viewer's side
	Body         *string   `json:"body"`
	HasImage     bool      `json:"has_image"`
	Hidden       bool      `json:"hidden"`
	HiddenReason *string   `json:"hidden_reason"`
	Event        *string   `json:"event"` // system lines: paid | cancelled
	CreatedAt    time.Time `json:"created_at"`
}

func newChatMessageView(m domain.PurchaseMessage, v service.ChatViewer) chatMessageView {
	out := chatMessageView{ID: m.ID, Author: m.AuthorRole, Mine: m.AuthorRole == v.Role(), Body: m.Body,
		HasImage: m.ImageKey != nil, Hidden: m.Hidden, HiddenReason: m.HiddenReason, Event: m.Event, CreatedAt: m.CreatedAt}
	if m.Hidden && !v.Admin {
		out.Body, out.HasImage = nil, false
	}
	return out
}

func viewer(c *gin.Context, admin bool) service.ChatViewer {
	return service.ChatViewer{UserID: userID(c), Admin: admin}
}

// BuyerChat handles GET /api/me/purchases/:id/messages?after=<id> → {request, messages: [≤ 50 after
// that id, oldest first]}. The caller's own request only (else 404), in any status.
func (h *PurchaseHandler) BuyerChat(c *gin.Context) { h.chat(c, false) }

// AdminChat handles GET /api/admin/purchases/:id/messages?after=<id>: every message, hidden ones
// too; reading marks them read.
func (h *PurchaseHandler) AdminChat(c *gin.Context) { h.chat(c, true) }

func (h *PurchaseHandler) chat(c *gin.Context, admin bool) {
	id, ok := pathUUID(c, "id")
	if !ok {
		return
	}
	after, err := strconv.ParseInt(c.DefaultQuery("after", "0"), 10, 64)
	if err != nil || after < 0 {
		badRequest(c, "after must be a message id")
		return
	}
	v := viewer(c, admin)
	p, msgs, err := h.svc.Chat(c.Request.Context(), v, id, after)
	if err != nil {
		writeError(c, err)
		return
	}
	views := mapSlice(msgs, func(m domain.PurchaseMessage) chatMessageView { return newChatMessageView(m, v) })
	if admin {
		c.JSON(http.StatusOK, gin.H{"request": newAdminPurchaseView(p), "messages": views})
		return
	}
	c.JSON(http.StatusOK, gin.H{"request": newPurchaseView(p), "messages": views})
}

// BuyerPost handles POST /api/me/purchases/:id/messages: JSON {body} or multipart (field "body" and/or
// file "image": JPEG/PNG/WebP/GIF ≤ 5 MB) → 201 the message. 400 empty or over 1000 characters,
// 409 chat_closed (cancelled or rejected), 413 a photo over 5 MB.
func (h *PurchaseHandler) BuyerPost(c *gin.Context) { h.post(c, false) }

// AdminPost handles POST /api/admin/purchases/:id/messages, the same as the buyer's.
func (h *PurchaseHandler) AdminPost(c *gin.Context) { h.post(c, true) }

func (h *PurchaseHandler) post(c *gin.Context, admin bool) {
	id, ok := pathUUID(c, "id")
	if !ok {
		return
	}
	body, image, ok := readChatMessage(c)
	if !ok {
		return
	}
	v := viewer(c, admin)
	m, err := h.svc.PostMessage(c.Request.Context(), v, id, body, image)
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusCreated, newChatMessageView(m, v))
}

func imageTooLarge(c *gin.Context) {
	c.AbortWithStatusJSON(http.StatusRequestEntityTooLarge, errorResponse{Error: "image is too large", Code: "image_too_large"})
}

// readChatMessage reads {body} from JSON, or "body" and the file "image" from a multipart form
// (the same 5 MB limit as photo import). false = the response is written already.
func readChatMessage(c *gin.Context) (string, []byte, bool) {
	if !strings.HasPrefix(c.ContentType(), "multipart/") {
		var req struct {
			Body string `json:"body"`
		}
		if !bindSmallJSON(c, &req) {
			return "", nil, false
		}
		return req.Body, nil, true
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, service.MaxPhotoBytes+photoFormOverhead)
	if err := c.Request.ParseMultipartForm(1 << 20); err != nil {
		var tooBig *http.MaxBytesError
		if errors.As(err, &tooBig) {
			imageTooLarge(c)
		} else {
			badRequest(c, "invalid multipart form")
		}
		return "", nil, false
	}
	body := c.Request.FormValue("body")
	files := c.Request.MultipartForm.File["image"]
	if len(files) == 0 {
		return body, nil, true
	}
	if files[0].Size > service.MaxPhotoBytes {
		imageTooLarge(c)
		return "", nil, false
	}
	f, err := files[0].Open()
	if err != nil {
		badRequest(c, "cannot read the image")
		return "", nil, false
	}
	defer f.Close()
	data, err := io.ReadAll(io.LimitReader(f, service.MaxPhotoBytes+1))
	if err != nil {
		badRequest(c, "cannot read the image")
		return "", nil, false
	}
	if len(data) > service.MaxPhotoBytes {
		imageTooLarge(c)
		return "", nil, false
	}
	return body, data, true
}

// BuyerImage handles GET /api/me/purchases/:id/messages/:mid/image → the photo (404 when the message
// has none, or is hidden from the buyer's side).
func (h *PurchaseHandler) BuyerImage(c *gin.Context) { h.image(c, false) }

// AdminImage handles GET /api/admin/purchases/:id/messages/:mid/image.
func (h *PurchaseHandler) AdminImage(c *gin.Context) { h.image(c, true) }

func (h *PurchaseHandler) image(c *gin.Context, admin bool) {
	id, ok := pathUUID(c, "id")
	if !ok {
		return
	}
	mid, err := strconv.ParseInt(c.Param("mid"), 10, 64)
	if err != nil || mid <= 0 {
		badRequest(c, "invalid message id")
		return
	}
	img, err := h.svc.MessageImage(c.Request.Context(), viewer(c, admin), id, mid)
	if err != nil {
		writeError(c, err)
		return
	}
	c.Header("Cache-Control", "private, max-age=86400")
	c.Header("X-Content-Type-Options", "nosniff")
	c.Header("Content-Disposition", "inline")
	c.Data(http.StatusOK, img.ContentType, img.Data)
}
