package handler

import (
	"errors"
	"log/slog"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"learnwords/internal/domain"
)

type errorResponse struct {
	Error string `json:"error"`
	// Code is a stable machine-readable reason for the few errors a client reacts to specially.
	Code string `json:"code,omitempty"`
	// FolderID: with own_folder — the caller's own folder, so the client can open it.
	FolderID string `json:"folder_id,omitempty"`
	// Limit: with daily_limit — the daily limit that was reached.
	Limit *int `json:"limit,omitempty"`
	// Credits: with daily_limit — the purchased balance (always present there, also when 0).
	Credits *int `json:"credits,omitempty"`
}

// requestLogAttrs: what an operator needs to find a failed request — error text, method, path
// (the real URL path, not the route pattern), user_id when authenticated.
func requestLogAttrs(c *gin.Context, err error) []any {
	attrs := []any{"err", err, "method", c.Request.Method, "path", c.Request.URL.Path}
	if v, ok := c.Get(userIDKey); ok {
		attrs = append(attrs, "user_id", v)
	}
	return attrs
}

func writeError(c *gin.Context, err error) {
	status, msg := http.StatusInternalServerError, "internal error"
	switch {
	case errors.Is(err, domain.ErrValidation):
		status, msg = http.StatusBadRequest, err.Error()
	case errors.Is(err, domain.ErrNotFound):
		status, msg = http.StatusNotFound, "not found"
	case errors.Is(err, domain.ErrOwnFolder):
		resp := errorResponse{Error: "own folder", Code: "own_folder"}
		if id, ok := domain.IsOwnFolder(err); ok {
			resp.FolderID = id.String()
		}
		c.AbortWithStatusJSON(http.StatusConflict, resp)
		return
	case errors.Is(err, domain.ErrLangMismatch):
		c.AbortWithStatusJSON(http.StatusUnprocessableEntity, errorResponse{Error: "folder language does not match your learning language", Code: "lang_mismatch"})
		return
	case errors.Is(err, domain.ErrPhotoNotDocument):
		c.AbortWithStatusJSON(http.StatusUnprocessableEntity, errorResponse{Error: "no study text in the photo", Code: "photo_not_document"})
		return
	case errors.Is(err, domain.ErrPhotoUnreadable):
		c.AbortWithStatusJSON(http.StatusUnprocessableEntity, errorResponse{Error: "the text in the photo cannot be read", Code: "photo_unreadable"})
		return
	case errors.Is(err, domain.ErrPhotoTooSlow): // before ErrUpstream: it is one, with its own code
		slog.ErrorContext(c.Request.Context(), "upstream failed", requestLogAttrs(c, err)...)
		c.AbortWithStatusJSON(http.StatusBadGateway, errorResponse{Error: "the photo took too long to read", Code: "photo_too_slow"})
		return
	case errors.Is(err, domain.ErrPushDisabled):
		c.AbortWithStatusJSON(http.StatusServiceUnavailable, errorResponse{Error: "push notifications are not configured", Code: "push_disabled"})
		return
	case errors.Is(err, domain.ErrFeatureDisabled):
		c.AbortWithStatusJSON(http.StatusForbidden, errorResponse{Error: "this feature is disabled for your account", Code: "feature_disabled"})
		return
	case errors.Is(err, domain.ErrDailyLimit):
		resp := errorResponse{Error: "daily limit reached", Code: "daily_limit"}
		if n, ok := domain.DailyLimitOf(err); ok {
			resp.Limit = &n
		}
		credits, _ := domain.CreditsOf(err)
		resp.Credits = &credits
		c.AbortWithStatusJSON(http.StatusTooManyRequests, resp)
		return
	case errors.Is(err, domain.ErrTooManyPending):
		c.AbortWithStatusJSON(http.StatusConflict, errorResponse{Error: "too many pending purchase requests", Code: "too_many_pending"})
		return
	case errors.Is(err, domain.ErrChatClosed):
		c.AbortWithStatusJSON(http.StatusConflict, errorResponse{Error: "the purchase request is cancelled", Code: "chat_closed"})
		return
	case errors.Is(err, domain.ErrPurchaseDecided):
		c.AbortWithStatusJSON(http.StatusConflict, errorResponse{Error: "purchase request is already decided", Code: "already_decided"})
		return
	case errors.Is(err, domain.ErrTelegramUnavailable):
		c.AbortWithStatusJSON(http.StatusServiceUnavailable, errorResponse{Error: "telegram is not configured", Code: "telegram_unavailable"})
		return
	case errors.Is(err, domain.ErrInvalidName):
		c.AbortWithStatusJSON(http.StatusBadRequest, errorResponse{Error: "name must be 2 to 80 characters", Code: "invalid_name"})
		return
	case errors.Is(err, domain.ErrInvalidPhone):
		c.AbortWithStatusJSON(http.StatusBadRequest, errorResponse{Error: "phone must look like +998901234567", Code: "invalid_phone"})
		return
	case errors.Is(err, domain.ErrPaymentsUnavailable):
		c.AbortWithStatusJSON(http.StatusServiceUnavailable, errorResponse{Error: "payments are not configured", Code: "payments_unavailable"})
		return
	case errors.Is(err, domain.ErrAlreadyExists):
		status, msg = http.StatusConflict, "already exists"
	case errors.Is(err, domain.ErrInvalidCredentials):
		status, msg = http.StatusUnauthorized, "invalid email or password"
	case errors.Is(err, domain.ErrUnauthorized):
		status, msg = http.StatusUnauthorized, "unauthorized"
	case errors.Is(err, domain.ErrBanned):
		status, msg = http.StatusForbidden, "account is banned"
	case errors.Is(err, domain.ErrForbidden):
		status, msg = http.StatusForbidden, "forbidden"
	case errors.Is(err, domain.ErrUnavailable):
		status, msg = http.StatusServiceUnavailable, "example generation is not configured"
	case errors.Is(err, domain.ErrUpstream):
		slog.ErrorContext(c.Request.Context(), "upstream failed", requestLogAttrs(c, err)...)
		status, msg = http.StatusBadGateway, err.Error()
	default:
		// The details stay in the log; the client only ever gets "internal error".
		slog.ErrorContext(c.Request.Context(), "request failed", requestLogAttrs(c, err)...)
	}
	c.AbortWithStatusJSON(status, errorResponse{Error: msg})
}

func badRequest(c *gin.Context, msg string) {
	c.AbortWithStatusJSON(http.StatusBadRequest, errorResponse{Error: msg})
}

func pathUUID(c *gin.Context, name string) (uuid.UUID, bool) {
	id, err := uuid.Parse(c.Param(name))
	if err != nil {
		badRequest(c, "invalid "+name)
		return uuid.Nil, false
	}
	return id, true
}

func pagination(c *gin.Context) (limit, offset int) {
	limit, _ = strconv.Atoi(c.DefaultQuery("limit", "20"))
	offset, _ = strconv.Atoi(c.DefaultQuery("offset", "0"))
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	if offset < 0 {
		offset = 0
	}
	return
}
