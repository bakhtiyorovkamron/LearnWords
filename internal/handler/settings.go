package handler

import (
	"context"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

// SettingsStore persists per-user UI settings.
type SettingsStore interface {
	InterfaceLanguage(ctx context.Context, id uuid.UUID) (string, error)
	SetInterfaceLanguage(ctx context.Context, id uuid.UUID, lang string) error
	ReviewSessionSize(ctx context.Context, id uuid.UUID) (string, error)
	SetReviewSessionSize(ctx context.Context, id uuid.UUID, size string) error
}

type SettingsHandler struct{ store SettingsStore }

func NewSettingsHandler(store SettingsStore) *SettingsHandler { return &SettingsHandler{store: store} }

var supportedLanguages = map[string]bool{"ru": true, "en": true, "uz": true}

var supportedReviewSessionSizes = map[string]bool{"10": true, "20": true, "50": true, "all": true}

// Get handles GET /api/me/settings → {"interface_language": "ru"|"en"|"uz"|"", "review_session_size": "10"|"20"|"50"|"all"|""}.
func (h *SettingsHandler) Get(c *gin.Context) {
	ctx := c.Request.Context()
	lang, err := h.store.InterfaceLanguage(ctx, userID(c))
	if err != nil {
		writeError(c, err)
		return
	}
	size, err := h.store.ReviewSessionSize(ctx, userID(c))
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"interface_language": lang, "review_session_size": size})
}

// Update handles PUT /api/me/settings {"interface_language"?, "review_session_size"?} — each
// field is independently optional, so one setting can be changed without resending the other.
func (h *SettingsHandler) Update(c *gin.Context) {
	var req struct {
		InterfaceLanguage *string `json:"interface_language"`
		ReviewSessionSize *string `json:"review_session_size"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequest(c, "invalid JSON body")
		return
	}
	if req.InterfaceLanguage == nil && req.ReviewSessionSize == nil {
		badRequest(c, "nothing to update")
		return
	}
	ctx := c.Request.Context()
	if req.InterfaceLanguage != nil {
		if !supportedLanguages[*req.InterfaceLanguage] {
			badRequest(c, "interface_language must be one of: ru, en, uz")
			return
		}
		if err := h.store.SetInterfaceLanguage(ctx, userID(c), *req.InterfaceLanguage); err != nil {
			writeError(c, err)
			return
		}
	}
	if req.ReviewSessionSize != nil {
		if !supportedReviewSessionSizes[*req.ReviewSessionSize] {
			badRequest(c, "review_session_size must be one of: 10, 20, 50, all")
			return
		}
		if err := h.store.SetReviewSessionSize(ctx, userID(c), *req.ReviewSessionSize); err != nil {
			writeError(c, err)
			return
		}
	}
	h.Get(c)
}
