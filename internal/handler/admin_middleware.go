package handler

import (
	"context"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"learnwords/internal/domain"
)

const roleKey = "userRole"

// UserStatusStore reads the live role/ban state and learning language of a user from the database.
type UserStatusStore interface {
	UserStatus(ctx context.Context, id uuid.UUID) (role, learningLang string, banned bool, err error)
}

// ActiveUser runs after AuthRequired on every protected route. It re-reads the user from
// the DB so that bans and role changes take effect immediately (not only after the JWT expires).
// It also stores the user's learning language in the request context (domain.LangFrom).
func ActiveUser(store UserStatusStore) gin.HandlerFunc {
	return func(c *gin.Context) {
		role, lang, banned, err := store.UserStatus(c.Request.Context(), userID(c))
		if err != nil {
			if err == domain.ErrNotFound { // user deleted
				c.AbortWithStatusJSON(http.StatusUnauthorized, errorResponse{Error: "unauthorized"})
				return
			}
			writeError(c, err)
			return
		}
		if banned {
			c.AbortWithStatusJSON(http.StatusForbidden, errorResponse{Error: "account is banned"})
			return
		}
		c.Set(roleKey, role)
		c.Request = c.Request.WithContext(domain.WithLang(c.Request.Context(), lang))
		c.Next()
	}
}

// RequireAdmin allows the request only for users whose role in the DB is 'admin'.
// The role is never taken from the client or the token — only from ActiveUser's DB lookup.
func RequireAdmin() gin.HandlerFunc {
	return func(c *gin.Context) {
		if c.GetString(roleKey) != domain.RoleAdmin {
			c.AbortWithStatusJSON(http.StatusForbidden, errorResponse{Error: "forbidden"})
			return
		}
		c.Next()
	}
}
