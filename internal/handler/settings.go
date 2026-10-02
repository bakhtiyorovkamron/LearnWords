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
}

type SettingsHandler struct{ store SettingsStore }

func NewSettingsHandler(store SettingsStore) *SettingsHandler { return &SettingsHandler{store: store} }

var supportedLanguages = map[string]bool{"ru": true, "en": true}

// Get handles GET /api/me/settings → {"interface_language": "ru"|"en"|""}.
func (h *SettingsHandler) Get(c *gin.Context) {
	lang, err := h.store.InterfaceLanguage(c.Request.Context(), userID(c))
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"interface_language": lang})
}

// Update handles PUT /api/me/settings {"interface_language": "ru"|"en"}.
func (h *SettingsHandler) Update(c *gin.Context) {
	var req struct {
		InterfaceLanguage string `json:"interface_language"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || !supportedLanguages[req.InterfaceLanguage] {
		badRequest(c, "interface_language must be one of: ru, en")
		return
	}
	if err := h.store.SetInterfaceLanguage(c.Request.Context(), userID(c), req.InterfaceLanguage); err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"interface_language": req.InterfaceLanguage})
}
