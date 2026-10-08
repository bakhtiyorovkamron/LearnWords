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

type AdminHandler struct {
	store AdminStore
	users UserGetter
}

func NewAdminHandler(store AdminStore, users UserGetter) *AdminHandler {
	return &AdminHandler{store: store, users: users}
}

// Me handles GET /api/me — current user's id, email and role (used by the UI to show the admin link).
func (h *AdminHandler) Me(c *gin.Context) {
	u, err := h.users.GetByID(c.Request.Context(), userID(c))
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"id": u.ID, "email": u.Email, "role": u.Role, "learning_language": u.LearningLanguage})
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
