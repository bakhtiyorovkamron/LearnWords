package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

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
	after, ok := afterParam(c)
	if !ok {
		return
	}
	v := viewer(c, admin)
	p, msgs, markers, err := h.svc.Chat(c.Request.Context(), v, id, after)
	if err != nil {
		writeError(c, err)
		return
	}
	if admin {
		c.JSON(http.StatusOK, chatMessagesResponse(msgs, v, markers, gin.H{"request": newAdminPurchaseView(p)}))
		return
	}
	c.JSON(http.StatusOK, chatMessagesResponse(msgs, v, markers, gin.H{"request": newPurchaseView(p)}))
}

// BuyerRead handles POST /api/me/purchases/:id/read {up_to: message id} → 204: the buyer has read
// the chat up to that message (never backwards). Someone else's request is a 404.
func (h *PurchaseHandler) BuyerRead(c *gin.Context) {
	id, ok := pathUUID(c, "id")
	if !ok {
		return
	}
	upTo, ok := readUpTo(c)
	if !ok {
		return
	}
	if err := h.svc.UserRead(c.Request.Context(), userID(c), id, upTo); err != nil {
		writeError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
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
	mid, ok := messageIDParam(c)
	if !ok {
		return
	}
	img, err := h.svc.MessageImage(c.Request.Context(), viewer(c, admin), id, mid)
	if err != nil {
		writeError(c, err)
		return
	}
	writeChatImage(c, img)
}
