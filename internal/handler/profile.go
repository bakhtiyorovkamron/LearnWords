package handler

import (
	"context"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"learnwords/internal/domain"
)

// ProfileStore persists the user's name and phone and reads the Telegram username.
type ProfileStore interface {
	Profile(ctx context.Context, id uuid.UUID) (domain.Profile, error)
	SetProfile(ctx context.Context, id uuid.UUID, fullName string, phone *string) error
}

type ProfileHandler struct{ store ProfileStore }

func NewProfileHandler(store ProfileStore) *ProfileHandler { return &ProfileHandler{store: store} }

type telegramStatus struct {
	Connected bool    `json:"connected"`
	Username  *string `json:"username"`
}

type profileResponse struct {
	FullName *string        `json:"full_name"`
	Phone    *string        `json:"phone"`
	Telegram telegramStatus `json:"telegram"`
}

func newProfileResponse(p domain.Profile) profileResponse {
	return profileResponse{FullName: p.FullName, Phone: p.Phone, Telegram: telegramStatus{Connected: p.TelegramConnected, Username: p.TelegramUsername}}
}

// Get handles GET /api/me/profile → {"full_name", "phone", "telegram": {"connected", "username"}}.
func (h *ProfileHandler) Get(c *gin.Context) {
	p, err := h.store.Profile(c.Request.Context(), userID(c))
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, newProfileResponse(p))
}

// Update handles PUT /api/me/profile {"full_name", "phone"}. The name is required (2..80 characters);
// the phone is optional (+998XXXXXXXXX, spaces and dashes are removed), empty clears it. Errors:
// 400 with the code "invalid_name" or "invalid_phone".
func (h *ProfileHandler) Update(c *gin.Context) {
	var req struct {
		FullName string `json:"full_name"`
		Phone    string `json:"phone"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequest(c, "invalid JSON body")
		return
	}
	name, err := domain.NormalizeName(req.FullName)
	if err != nil {
		writeError(c, err)
		return
	}
	phone, err := domain.NormalizePhone(req.Phone)
	if err != nil {
		writeError(c, err)
		return
	}
	var phonePtr *string
	if phone != "" {
		phonePtr = &phone
	}
	if err := h.store.SetProfile(c.Request.Context(), userID(c), name, phonePtr); err != nil {
		writeError(c, err)
		return
	}
	h.Get(c)
}
