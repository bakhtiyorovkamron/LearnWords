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

type ProfileHandler struct {
	store             ProfileStore
	telegramAvailable bool // the bot is configured (linking works)
}

func NewProfileHandler(store ProfileStore, telegramAvailable bool) *ProfileHandler {
	return &ProfileHandler{store: store, telegramAvailable: telegramAvailable}
}

type telegramStatus struct {
	Connected bool `json:"connected"`
	// Notifications: the user's switch for broadcasts (news and reminders) in Telegram.
	Notifications bool    `json:"notifications"`
	Username      *string `json:"username"`
	Available     bool    `json:"available"`   // false: no bot, connecting answers 503 telegram_unavailable
	BonusOffer    int     `json:"bonus_offer"` // photo credits connecting would give now (0 = none)
	Bonus         int     `json:"bonus"`       // photo credits connecting gave (0 = none)
}

type profileResponse struct {
	FullName *string        `json:"full_name"`
	Phone    *string        `json:"phone"`
	Telegram telegramStatus `json:"telegram"`
}

func (h *ProfileHandler) response(p domain.Profile) profileResponse {
	tg := telegramStatus{Connected: p.TelegramConnected, Username: p.TelegramUsername, Available: h.telegramAvailable, Bonus: p.TelegramBonus, Notifications: p.TelegramNotifications}
	if h.telegramAvailable {
		tg.BonusOffer = p.TelegramBonusOffer()
	}
	return profileResponse{FullName: p.FullName, Phone: p.Phone, Telegram: tg}
}

// Get handles GET /api/me/profile →
// {"full_name", "phone", "telegram": {"connected", "username", "available", "bonus_offer", "bonus"}}.
func (h *ProfileHandler) Get(c *gin.Context) {
	p, err := h.store.Profile(c.Request.Context(), userID(c))
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, h.response(p))
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
