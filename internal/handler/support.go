package handler

import (
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"learnwords/internal/domain"
	"learnwords/internal/service"
)

// SupportHandler: each user's support thread with the admin team (no purchase needed).
type SupportHandler struct{ svc *service.SupportService }

func NewSupportHandler(svc *service.SupportService) *SupportHandler { return &SupportHandler{svc: svc} }

// supportThreadView is a thread in the admins' list.
type supportThreadView struct {
	ID            int64      `json:"id"`
	UserID        uuid.UUID  `json:"user_id"`
	UserEmail     string     `json:"user_email"`
	Unread        int        `json:"unread"`  // the user's messages after the admins' last read
	Preview       *string    `json:"preview"` // the last message: ≤ 80 characters, hidden ones as "[скрыто]"
	LastMessageAt *time.Time `json:"last_message_at"`
	CreatedAt     time.Time  `json:"created_at"`
}

func newSupportThreadView(t domain.ChatThread) supportThreadView {
	v := supportThreadView{ID: t.ID, UserID: t.UserID, UserEmail: t.UserEmail, Unread: t.Unread,
		LastMessageAt: t.LastMessageAt, CreatedAt: t.CreatedAt}
	if t.LastMessage != nil {
		p := domain.ChatPreview(*t.LastMessage)
		v.Preview = &p
	}
	return v
}

func threadIDParam(c *gin.Context) (int64, bool) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || id <= 0 {
		badRequest(c, "invalid thread id")
		return 0, false
	}
	return id, true
}

// Messages handles GET /api/support/messages?after=<id> → {thread_id, messages: [≤ 50 after that id,
// oldest first]}. The caller's own thread, created on first use; their own hidden messages come as
// the warning (no text), the admins' hidden ones not at all.
func (h *SupportHandler) Messages(c *gin.Context) {
	after, ok := afterParam(c)
	if !ok {
		return
	}
	v := viewer(c, false)
	t, msgs, err := h.svc.UserMessages(c.Request.Context(), v.UserID, after)
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, chatMessagesResponse(msgs, v, t.ReadMarkers, gin.H{"thread_id": t.ID}))
}

// Read handles POST /api/support/read {up_to: message id} → 204: the caller has read their thread up
// to that message (never backwards, never past its newest one). Reading the messages does not.
func (h *SupportHandler) Read(c *gin.Context) {
	upTo, ok := readUpTo(c)
	if !ok {
		return
	}
	if err := h.svc.UserRead(c.Request.Context(), userID(c), upTo); err != nil {
		writeError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

// Post handles POST /api/support/messages: JSON {body} or multipart ("body" and/or the file "image",
// JPEG/PNG/WebP/GIF ≤ 5 MB) → 201 the stored message. 400 empty or over 1000 characters, 413 a
// photo over 5 MB; 20 messages per 10 minutes (429).
func (h *SupportHandler) Post(c *gin.Context) {
	body, image, ok := readChatMessage(c)
	if !ok {
		return
	}
	v := viewer(c, false)
	m, err := h.svc.UserPost(c.Request.Context(), v.UserID, body, image)
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusCreated, newChatMessageView(m, v))
}

// Image handles GET /api/support/messages/:mid/image → a photo of the caller's own thread.
func (h *SupportHandler) Image(c *gin.Context) {
	mid, ok := messageIDParam(c)
	if !ok {
		return
	}
	img, err := h.svc.UserImage(c.Request.Context(), userID(c), mid)
	if err != nil {
		writeError(c, err)
		return
	}
	writeChatImage(c, img)
}

// AdminThreads handles GET /api/admin/support/threads?unread=1 → {threads: [...]}: the threads with
// messages, newest conversation first; unread=1 keeps those with unread messages.
func (h *SupportHandler) AdminThreads(c *gin.Context) {
	ts, err := h.svc.Threads(c.Request.Context(), c.Query("unread") == "1")
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"threads": mapSlice(ts, newSupportThreadView)})
}

// AdminOpen handles POST /api/admin/support/threads {user_id} → the user's support thread in the shape
// of an item of the list (unread 0, preview null while it has no messages), created when the user
// never wrote. Idempotent; nothing is sent to the user. 400 for a missing or malformed user_id, 404
// user_not_found.
func (h *SupportHandler) AdminOpen(c *gin.Context) {
	var req struct {
		UserID string `json:"user_id"`
	}
	if !bindSmallJSON(c, &req) {
		return
	}
	uid, err := uuid.Parse(req.UserID)
	if err != nil {
		badRequest(c, "user_id must be a user id")
		return
	}
	t, err := h.svc.AdminOpen(c.Request.Context(), uid)
	if errors.Is(err, domain.ErrNotFound) {
		c.AbortWithStatusJSON(http.StatusNotFound, errorResponse{Error: "user not found", Code: "user_not_found"})
		return
	}
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, newSupportThreadView(t))
}

// AdminMessages handles GET /api/admin/support/threads/:id/messages?after=<id> → {thread, messages}:
// every message, hidden ones with their text. It does not mark anything read.
func (h *SupportHandler) AdminMessages(c *gin.Context) {
	id, ok := threadIDParam(c)
	if !ok {
		return
	}
	after, ok := afterParam(c)
	if !ok {
		return
	}
	t, msgs, err := h.svc.AdminMessages(c.Request.Context(), id, after)
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, chatMessagesResponse(msgs, viewer(c, true), t.ReadMarkers, gin.H{"thread": newSupportThreadView(t)}))
}

// AdminPost handles POST /api/admin/support/threads/:id/messages, the same body as the user's; the
// user is told (Telegram when linked, else push) without the text.
func (h *SupportHandler) AdminPost(c *gin.Context) {
	id, ok := threadIDParam(c)
	if !ok {
		return
	}
	body, image, ok := readChatMessage(c)
	if !ok {
		return
	}
	v := viewer(c, true)
	m, err := h.svc.AdminPost(c.Request.Context(), v.UserID, id, body, image)
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusCreated, newChatMessageView(m, v))
}

// AdminRead handles POST /api/admin/support/threads/:id/read {up_to?: message id} → the thread with
// its new unread count. Without up_to the whole thread counts as read.
func (h *SupportHandler) AdminRead(c *gin.Context) {
	id, ok := threadIDParam(c)
	if !ok {
		return
	}
	var req struct {
		UpTo int64 `json:"up_to"`
	}
	if c.Request.ContentLength != 0 && !bindSmallJSON(c, &req) {
		return
	}
	t, err := h.svc.MarkRead(c.Request.Context(), id, req.UpTo)
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, newSupportThreadView(t))
}

// AdminImage handles GET /api/admin/support/threads/:id/messages/:mid/image.
func (h *SupportHandler) AdminImage(c *gin.Context) {
	id, ok := threadIDParam(c)
	if !ok {
		return
	}
	mid, ok := messageIDParam(c)
	if !ok {
		return
	}
	img, err := h.svc.AdminImage(c.Request.Context(), id, mid)
	if err != nil {
		writeError(c, err)
		return
	}
	writeChatImage(c, img)
}
