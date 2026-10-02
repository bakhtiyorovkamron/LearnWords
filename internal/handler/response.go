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
}

func writeError(c *gin.Context, err error) {
	status, msg := http.StatusInternalServerError, "internal error"
	switch {
	case errors.Is(err, domain.ErrValidation):
		status, msg = http.StatusBadRequest, err.Error()
	case errors.Is(err, domain.ErrNotFound):
		status, msg = http.StatusNotFound, "not found"
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
		slog.ErrorContext(c.Request.Context(), "upstream failed", "err", err, "path", c.FullPath())
		status, msg = http.StatusBadGateway, err.Error()
	default:
		slog.ErrorContext(c.Request.Context(), "request failed", "err", err, "path", c.FullPath())
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
