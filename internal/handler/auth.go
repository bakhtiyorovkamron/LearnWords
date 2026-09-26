package handler

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"

	"learnwords/internal/domain"
	"learnwords/internal/service"
)

const refreshCookie = "lw_refresh"

type AuthHandler struct {
	svc          *service.AuthService
	cookieSecure bool
}

func NewAuthHandler(svc *service.AuthService, cookieSecure bool) *AuthHandler {
	return &AuthHandler{svc: svc, cookieSecure: cookieSecure}
}

type credentialsRequest struct {
	Email    string `json:"email" binding:"required,email"`
	Password string `json:"password" binding:"required,min=8,max=72"`
}

// accessResponse: the refresh token is never exposed to JS, only via httpOnly cookie.
type accessResponse struct {
	AccessToken     string       `json:"access_token"`
	AccessExpiresAt time.Time    `json:"access_expires_at"`
	User            *domain.User `json:"user,omitempty"`
}

func (h *AuthHandler) setRefreshCookie(c *gin.Context, p domain.TokenPair) {
	http.SetCookie(c.Writer, &http.Cookie{
		Name:     refreshCookie,
		Value:    p.RefreshToken,
		Path:     "/api/auth",
		Expires:  p.RefreshExpiresAt,
		HttpOnly: true,
		Secure:   h.cookieSecure,
		SameSite: http.SameSiteLaxMode,
	})
}

func (h *AuthHandler) clearRefreshCookie(c *gin.Context) {
	http.SetCookie(c.Writer, &http.Cookie{
		Name: refreshCookie, Value: "", Path: "/api/auth", MaxAge: -1,
		HttpOnly: true, Secure: h.cookieSecure, SameSite: http.SameSiteLaxMode,
	})
}

func (h *AuthHandler) Register(c *gin.Context) {
	var req credentialsRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequest(c, "email must be valid and password 8-72 characters")
		return
	}
	user, tokens, err := h.svc.Register(c.Request.Context(), req.Email, req.Password)
	if err != nil {
		writeError(c, err)
		return
	}
	h.setRefreshCookie(c, tokens)
	c.JSON(http.StatusCreated, accessResponse{tokens.AccessToken, tokens.AccessExpiresAt, user})
}

func (h *AuthHandler) Login(c *gin.Context) {
	var req credentialsRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequest(c, "email must be valid and password 8-72 characters")
		return
	}
	tokens, err := h.svc.Login(c.Request.Context(), req.Email, req.Password)
	if err != nil {
		writeError(c, err)
		return
	}
	h.setRefreshCookie(c, tokens)
	c.JSON(http.StatusOK, accessResponse{AccessToken: tokens.AccessToken, AccessExpiresAt: tokens.AccessExpiresAt})
}

// Refresh reads the refresh token from the httpOnly cookie and rotates it.
func (h *AuthHandler) Refresh(c *gin.Context) {
	token, err := c.Cookie(refreshCookie)
	if err != nil || token == "" {
		writeError(c, domain.ErrUnauthorized)
		return
	}
	tokens, err := h.svc.Refresh(c.Request.Context(), token)
	if err != nil {
		h.clearRefreshCookie(c)
		writeError(c, err)
		return
	}
	h.setRefreshCookie(c, tokens)
	c.JSON(http.StatusOK, accessResponse{AccessToken: tokens.AccessToken, AccessExpiresAt: tokens.AccessExpiresAt})
}

func (h *AuthHandler) Logout(c *gin.Context) {
	h.clearRefreshCookie(c)
	c.Status(http.StatusNoContent)
}
