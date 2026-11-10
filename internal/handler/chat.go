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

// What every chat with the admins shares over HTTP (support and purchase threads).

// chatMessageView is a chat line (support or purchase thread) as one side sees it. A hidden message
// reaches the user's side without its text or photo (only the reason); the admins get everything.
type chatMessageView struct {
	ID           int64     `json:"id"`
	Author       string    `json:"author"` // user | admin | system
	Mine         bool      `json:"mine"`   // written by the viewer's side
	Body         *string   `json:"body"`
	HasImage     bool      `json:"has_image"`
	Hidden       bool      `json:"hidden"`
	HiddenReason *string   `json:"hidden_reason"`
	Event        *string   `json:"event"` // system lines: paid | cancelled
	CreatedAt    time.Time `json:"created_at"`
}

func newChatMessageView(m domain.ChatMessage, v service.ChatViewer) chatMessageView {
	out := chatMessageView{ID: m.ID, Author: m.AuthorRole, Mine: m.AuthorRole == v.Role(), Body: m.Body,
		HasImage: m.ImageKey != nil, Hidden: m.Hidden, HiddenReason: m.HiddenReason, Event: m.Event, CreatedAt: m.CreatedAt}
	if m.Hidden && !v.Admin {
		out.Body, out.HasImage = nil, false
	}
	return out
}

// chatMessagesResponse is the body of every "messages" endpoint: the viewer's own read marker and
// the other side's next to the messages (0 = none yet).
func chatMessagesResponse(msgs []domain.ChatMessage, v service.ChatViewer, markers domain.ChatReadMarkers, extra gin.H) gin.H {
	own, other := markers.For(v.Admin)
	out := gin.H{"messages": chatViews(msgs, v), "read_message_id": own, "other_read_message_id": other}
	for k, val := range extra {
		out[k] = val
	}
	return out
}

// readUpTo reads {up_to: message id} of a read endpoint (missing = 0). false = answered already.
func readUpTo(c *gin.Context) (int64, bool) {
	var req struct {
		UpTo int64 `json:"up_to"`
	}
	if !bindSmallJSON(c, &req) {
		return 0, false
	}
	if req.UpTo < 0 {
		badRequest(c, "up_to must not be negative")
		return 0, false
	}
	return req.UpTo, true
}

func viewer(c *gin.Context, admin bool) service.ChatViewer {
	return service.ChatViewer{UserID: userID(c), Admin: admin}
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

// afterParam reads ?after=<message id> (0 when absent); false = a 400 is written.
func afterParam(c *gin.Context) (int64, bool) {
	after, err := strconv.ParseInt(c.DefaultQuery("after", "0"), 10, 64)
	if err != nil || after < 0 {
		badRequest(c, "after must be a message id")
		return 0, false
	}
	return after, true
}

// messageIDParam reads the :mid path parameter; false = a 400 is written.
func messageIDParam(c *gin.Context) (int64, bool) {
	mid, err := strconv.ParseInt(c.Param("mid"), 10, 64)
	if err != nil || mid <= 0 {
		badRequest(c, "invalid message id")
		return 0, false
	}
	return mid, true
}

// writeChatImage sends a chat photo: its stored type, private caching, never sniffed as anything else.
func writeChatImage(c *gin.Context, img domain.ChatImage) {
	c.Header("Cache-Control", "private, max-age=86400")
	c.Header("X-Content-Type-Options", "nosniff")
	c.Header("Content-Disposition", "inline")
	c.Data(http.StatusOK, img.ContentType, img.Data)
}

func chatViews(msgs []domain.ChatMessage, v service.ChatViewer) []chatMessageView {
	return mapSlice(msgs, func(m domain.ChatMessage) chatMessageView { return newChatMessageView(m, v) })
}

// ChatUnreadHandler: the unread badges' numbers.
type ChatUnreadHandler struct{ svc *service.ChatUnreadService }

func NewChatUnreadHandler(svc *service.ChatUnreadService) *ChatUnreadHandler {
	return &ChatUnreadHandler{svc: svc}
}

// Mine handles GET /api/me/chats/unread → {support, purchases: [{id, code, unread}], total}: the
// admins' and system messages the caller has not read.
func (h *ChatUnreadHandler) Mine(c *gin.Context) {
	u, err := h.svc.ForUser(c.Request.Context(), userID(c))
	if err != nil {
		writeError(c, err)
		return
	}
	type purchase struct {
		ID     string `json:"id"`
		Code   string `json:"code"`
		Unread int    `json:"unread"`
	}
	total := u.Support
	ps := make([]purchase, 0, len(u.Purchases))
	for _, p := range u.Purchases {
		ps = append(ps, purchase{ID: p.ID.String(), Code: p.Code, Unread: p.Unread})
		total += p.Unread
	}
	c.JSON(http.StatusOK, gin.H{"support": u.Support, "purchases": ps, "total": total})
}

// Admin handles GET /api/admin/chats/unread → {support, purchases, total}: the users' messages no
// admin has read yet.
func (h *ChatUnreadHandler) Admin(c *gin.Context) {
	u, err := h.svc.ForAdmins(c.Request.Context())
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"support": u.Support, "purchases": u.Purchases, "total": u.Support + u.Purchases})
}
