package handler

import (
	"context"
	"net/http"
	"regexp"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"learnwords/internal/domain"
)

// shareURL: the public link to a folder, on the host the request came in on (Caddy forwards Host
// and X-Forwarded-Proto), e.g. https://yodla.fun/s/aB3dE5gH7k.
func shareURL(c *gin.Context, token string) string {
	scheme := "http"
	if p := c.GetHeader("X-Forwarded-Proto"); p == "https" || p == "http" {
		scheme = p
	} else if c.Request.TLS != nil {
		scheme = "https"
	}
	return scheme + "://" + c.Request.Host + "/s/" + token
}

func (h *FolderHandler) shareResponse(c *gin.Context, token string, err error) {
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, domain.ShareInfo{Token: token, URL: shareURL(c, token)})
}

// EnableShare handles POST /api/folders/:id/share — turns the public link on, or returns the
// existing one. Only the owner's folder (else 404).
func (h *FolderHandler) EnableShare(c *gin.Context) {
	id, ok := pathUUID(c, "id")
	if !ok {
		return
	}
	token, err := h.store.EnableShare(c.Request.Context(), userID(c), id)
	h.shareResponse(c, token, err)
}

// RegenerateShare handles POST /api/folders/:id/share/regenerate — a new token; the old link
// stops working.
func (h *FolderHandler) RegenerateShare(c *gin.Context) {
	id, ok := pathUUID(c, "id")
	if !ok {
		return
	}
	token, err := h.store.RegenerateShare(c.Request.Context(), userID(c), id)
	h.shareResponse(c, token, err)
}

// DisableShare handles DELETE /api/folders/:id/share — the link stops working.
func (h *FolderHandler) DisableShare(c *gin.Context) {
	id, ok := pathUUID(c, "id")
	if !ok {
		return
	}
	if err := h.store.DisableShare(c.Request.Context(), userID(c), id); err != nil {
		writeError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

// --- public side ---------------------------------------------------------------------------

type SharedStore interface {
	GetShared(ctx context.Context, token, lang string) (*domain.SharedFolder, error)
	ImportShared(ctx context.Context, callerID uuid.UUID, callerLang, token string, maxFolders int) (*domain.ImportResult, error)
}

type SharedHandler struct{ store SharedStore }

func NewSharedHandler(store SharedStore) *SharedHandler { return &SharedHandler{store: store} }

// Tokens are exactly 10 base62 characters; anything else is a 404 without touching the database.
var shareTokenRe = regexp.MustCompile(`^[0-9A-Za-z]{10}$`)

func sharedToken(c *gin.Context) (string, bool) {
	t := c.Param("token")
	if !shareTokenRe.MatchString(t) {
		writeError(c, domain.ErrNotFound)
		return "", false
	}
	return t, true
}

// interfaceLang: ?lang=ru|en|uz, else the first supported tag of Accept-Language, else "".
func interfaceLang(c *gin.Context) string {
	supported := func(s string) string {
		s = strings.ToLower(strings.TrimSpace(s))
		if i := strings.IndexAny(s, "-_;"); i >= 0 {
			s = s[:i]
		}
		if supportedLanguages[s] {
			return s
		}
		return ""
	}
	if l := supported(c.Query("lang")); l != "" {
		return l
	}
	for _, part := range strings.Split(c.GetHeader("Accept-Language"), ",") {
		if l := supported(part); l != "" {
			return l
		}
	}
	return ""
}

// Get handles GET /api/shared/:token — NO auth. The words of a shared folder, without anything that
// identifies the owner or their progress. Unknown or turned-off token → 404.
func (h *SharedHandler) Get(c *gin.Context) {
	token, ok := sharedToken(c)
	if !ok {
		return
	}
	sf, err := h.store.GetShared(c.Request.Context(), token, interfaceLang(c))
	if err != nil {
		writeError(c, err)
		return
	}
	c.Header("Cache-Control", "no-store") // turning the link off must take effect at once
	c.JSON(http.StatusOK, sf)
}

// Import handles POST /api/shared/:token/import — copies the folder into the caller's account.
// 404 bad token, 409 own folder, 422 lang_mismatch, 400 too many folders.
func (h *SharedHandler) Import(c *gin.Context) {
	token, ok := sharedToken(c)
	if !ok {
		return
	}
	ctx := c.Request.Context()
	res, err := h.store.ImportShared(ctx, userID(c), domain.LangFrom(ctx), token, maxFolders)
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}
