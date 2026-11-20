package handler

import (
	"context"
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
	telegram     TelegramLogin // nil = no sign-in with Telegram
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
	var req struct {
		credentialsRequest
		// "de" | "en" | "fr" | "ko"; empty = German.
		LearningLanguage string `json:"learning_language"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequest(c, "email must be valid and password 8-72 characters")
		return
	}
	user, tokens, err := h.svc.Register(c.Request.Context(), req.Email, req.Password, req.LearningLanguage)
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

// TelegramLogin is the sign-in with Telegram (service.TelegramLoginService).
type TelegramLogin interface {
	Start(ctx context.Context, userAgent string) (domain.TelegramLoginStart, error)
	Poll(ctx context.Context, secret string) (domain.TelegramLoginPoll, error)
}

// WithTelegramLogin turns the sign-in with Telegram on (without it both endpoints answer 503).
func (h *AuthHandler) WithTelegramLogin(tg TelegramLogin) *AuthHandler {
	h.telegram = tg
	return h
}

// TelegramStart handles POST /api/auth/telegram → {"url": "https://t.me/<bot>?start=login_…",
// "secret", "expires_at"}; 503 telegram_unavailable when the bot is not configured. The secret is
// only in this answer: the browser polls with it.
func (h *AuthHandler) TelegramStart(c *gin.Context) {
	if h.telegram == nil {
		writeError(c, domain.ErrTelegramUnavailable)
		return
	}
	start, err := h.telegram.Start(c.Request.Context(), c.Request.UserAgent())
	if err != nil {
		writeError(c, err)
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, start)
}

// TelegramPoll handles POST /api/auth/telegram/poll {"secret"} → {"status": "pending" | "denied" |
// "expired"}, or once confirmed in Telegram the refresh cookie (as Login) and {"status": "ok",
// "access_token", "access_expires_at", "new_user"}. Only the first poll gets the session.
func (h *AuthHandler) TelegramPoll(c *gin.Context) {
	if h.telegram == nil {
		writeError(c, domain.ErrTelegramUnavailable)
		return
	}
	var req struct {
		Secret string `json:"secret"`
	}
	if !bindSmallJSON(c, &req) {
		return
	}
	if req.Secret == "" {
		badRequest(c, "secret is required")
		return
	}
	res, err := h.telegram.Poll(c.Request.Context(), req.Secret)
	if err != nil {
		writeError(c, err)
		return
	}
	c.Header("Cache-Control", "no-store")
	if res.Status != domain.PollOK {
		c.JSON(http.StatusOK, gin.H{"status": res.Status})
		return
	}
	h.setRefreshCookie(c, res.Tokens)
	c.JSON(http.StatusOK, gin.H{"status": res.Status, "access_token": res.Tokens.AccessToken,
		"access_expires_at": res.Tokens.AccessExpiresAt, "new_user": res.NewUser})
}
