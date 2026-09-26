package handler

import (
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"go.opentelemetry.io/otel/trace"

	"learnwords/internal/auth"
	"learnwords/internal/service"
)

const userIDKey = "userID"

// RequestLogger logs each request with its trace ID (must run after otelgin middleware).
func RequestLogger() gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		c.Next()
		sc := trace.SpanFromContext(c.Request.Context()).SpanContext()
		slog.InfoContext(c.Request.Context(), "http request",
			"method", c.Request.Method,
			"path", c.Request.URL.Path,
			"status", c.Writer.Status(),
			"duration_ms", time.Since(start).Milliseconds(),
			"client_ip", c.ClientIP(),
			"trace_id", sc.TraceID().String(),
		)
	}
}

// Recovery converts panics into JSON 500 responses.
func Recovery() gin.HandlerFunc {
	return gin.CustomRecovery(func(c *gin.Context, rec any) {
		slog.ErrorContext(c.Request.Context(), "panic recovered", "panic", rec, "path", c.Request.URL.Path)
		c.AbortWithStatusJSON(http.StatusInternalServerError, errorResponse{Error: "internal error"})
	})
}

func AuthRequired(tokens service.TokenManager) gin.HandlerFunc {
	return func(c *gin.Context) {
		h := c.GetHeader("Authorization")
		token, ok := strings.CutPrefix(h, "Bearer ")
		if !ok || token == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, errorResponse{Error: "missing bearer token"})
			return
		}
		uid, err := tokens.Parse(token, auth.TypeAccess)
		if err != nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, errorResponse{Error: "invalid token"})
			return
		}
		c.Set(userIDKey, uid)
		c.Next()
	}
}

func userID(c *gin.Context) uuid.UUID {
	return c.MustGet(userIDKey).(uuid.UUID)
}
