package handler

import (
	"context"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"learnwords/internal/domain"
)

type AdminStore interface {
	ListUsers(ctx context.Context) ([]domain.AdminUser, error)
	Stats(ctx context.Context) (domain.AdminStats, error)
	DeleteUser(ctx context.Context, id uuid.UUID) error
	SetBanned(ctx context.Context, id uuid.UUID, banned bool) error
}

type UserGetter interface {
	GetByID(ctx context.Context, id uuid.UUID) (*domain.User, error)
}

// FeatureAdmin reads and edits per-user features.
type FeatureAdmin interface {
	States(ctx context.Context, userID uuid.UUID) ([]domain.FeatureState, error)
	State(ctx context.Context, userID uuid.UUID, feature string) (domain.FeatureState, error)
	Set(ctx context.Context, userID uuid.UUID, feature string, enabled bool, dailyLimit *int) error
}

type AdminHandler struct {
	store    AdminStore
	users    UserGetter
	features FeatureAdmin
}

func NewAdminHandler(store AdminStore, users UserGetter, features FeatureAdmin) *AdminHandler {
	return &AdminHandler{store: store, users: users, features: features}
}

// Me handles GET /api/me — current user's id, email and role (used by the UI to show the admin link).
func (h *AdminHandler) Me(c *gin.Context) {
	u, err := h.users.GetByID(c.Request.Context(), userID(c))
	if err != nil {
		writeError(c, err)
		return
	}
	states, err := h.features.States(c.Request.Context(), u.ID)
	if err != nil {
		writeError(c, err)
		return
	}
	features := make(map[string]gin.H, len(states))
	for _, st := range states {
		features[st.Feature] = gin.H{"enabled": st.Enabled, "daily_limit": st.DailyLimit, "remaining": st.Remaining}
	}
	c.JSON(http.StatusOK, gin.H{"id": u.ID, "email": u.Email, "role": u.Role, "learning_language": u.LearningLanguage, "features": features})
}

// UserFeatures handles GET /api/admin/users/:id/features.
func (h *AdminHandler) UserFeatures(c *gin.Context) {
	id, ok := pathUUID(c, "id")
	if !ok {
		return
	}
	if _, err := h.users.GetByID(c.Request.Context(), id); err != nil {
		writeError(c, err)
		return
	}
	states, err := h.features.States(c.Request.Context(), id)
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"features": states})
}

// SetUserFeature handles PUT /api/admin/users/:id/features/:feature {"enabled": bool, "daily_limit": number|null}.
func (h *AdminHandler) SetUserFeature(c *gin.Context) {
	id, ok := pathUUID(c, "id")
	if !ok {
		return
	}
	var req struct {
		Enabled    *bool `json:"enabled"`
		DailyLimit *int  `json:"daily_limit"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || req.Enabled == nil {
		badRequest(c, `body must be {"enabled": true|false, "daily_limit": number|null}`)
		return
	}
	ctx := c.Request.Context()
	feature := c.Param("feature")
	if !domain.IsFeature(feature) {
		badRequest(c, "unknown feature")
		return
	}
	if _, err := h.users.GetByID(ctx, id); err != nil {
		writeError(c, err)
		return
	}
	if err := h.features.Set(ctx, id, feature, *req.Enabled, req.DailyLimit); err != nil {
		writeError(c, err)
		return
	}
	st, err := h.features.State(ctx, id, feature)
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, st)
}

// Users handles GET /api/admin/users.
func (h *AdminHandler) Users(c *gin.Context) {
	users, err := h.store.ListUsers(c.Request.Context())
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"users": users})
}

// Stats handles GET /api/admin/stats.
func (h *AdminHandler) Stats(c *gin.Context) {
	s, err := h.store.Stats(c.Request.Context())
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, s)
}

// target loads the user an action is applied to and refuses actions on yourself or on other admins.
func (h *AdminHandler) target(c *gin.Context) (uuid.UUID, bool) {
	id, ok := pathUUID(c, "id")
	if !ok {
		return uuid.Nil, false
	}
	if id == userID(c) {
		c.AbortWithStatusJSON(http.StatusBadRequest, errorResponse{Error: "you cannot apply this action to yourself"})
		return uuid.Nil, false
	}
	u, err := h.users.GetByID(c.Request.Context(), id)
	if err != nil {
		writeError(c, err)
		return uuid.Nil, false
	}
	if u.Role == domain.RoleAdmin {
		c.AbortWithStatusJSON(http.StatusForbidden, errorResponse{Error: "cannot apply this action to an admin"})
		return uuid.Nil, false
	}
	return id, true
}

// DeleteUser handles DELETE /api/admin/users/:id (cascades to all of the user's data).
func (h *AdminHandler) DeleteUser(c *gin.Context) {
	id, ok := h.target(c)
	if !ok {
		return
	}
	if err := h.store.DeleteUser(c.Request.Context(), id); err != nil {
		writeError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

// Ban handles PATCH /api/admin/users/:id/ban {"banned": true|false}.
func (h *AdminHandler) Ban(c *gin.Context) {
	var req struct {
		Banned *bool `json:"banned"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || req.Banned == nil {
		badRequest(c, `body must be {"banned": true|false}`)
		return
	}
	id, ok := h.target(c)
	if !ok {
		return
	}
	if err := h.store.SetBanned(c.Request.Context(), id, *req.Banned); err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"id": id, "is_banned": *req.Banned})
}
