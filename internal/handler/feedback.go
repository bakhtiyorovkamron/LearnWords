package handler

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"learnwords/internal/domain"
)

// FeedbackStore keeps the one answer per user to the feedback window.
type FeedbackStore interface {
	Answered(ctx context.Context, userID uuid.UUID) (bool, error)
	Submit(ctx context.Context, userID uuid.UUID, rating int, comment string) error
	Dismiss(ctx context.Context, userID uuid.UUID) error
	Summary(ctx context.Context) (domain.FeedbackSummary, error)
}

// askFeedback: the user is asked once their account is old enough and they have not answered.
func askFeedback(ctx context.Context, store FeedbackStore, u *domain.User, now time.Time) (bool, error) {
	if now.Sub(u.CreatedAt) < domain.FeedbackAfter {
		return false, nil
	}
	answered, err := store.Answered(ctx, u.ID)
	return !answered, err
}

type FeedbackHandler struct{ store FeedbackStore }

func NewFeedbackHandler(store FeedbackStore) *FeedbackHandler { return &FeedbackHandler{store: store} }

const maxFeedbackBody = 8 << 10

// Submit handles POST /api/feedback {"rating": 1-5, "comment"?: ≤1000 characters} → 204.
// Only the first answer counts; a repeat is a 204 that changes nothing.
func (h *FeedbackHandler) Submit(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxFeedbackBody)
	var req struct {
		Rating  *int   `json:"rating"`
		Comment string `json:"comment"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		var tooBig *http.MaxBytesError
		if errors.As(err, &tooBig) {
			c.AbortWithStatusJSON(http.StatusRequestEntityTooLarge, errorResponse{Error: "request body too large"})
		} else {
			badRequest(c, `body must be {"rating": 1-5, "comment": "..."}`)
		}
		return
	}
	if req.Rating == nil || *req.Rating < domain.FeedbackMinRating || *req.Rating > domain.FeedbackMaxRating {
		badRequest(c, "rating must be 1-5")
		return
	}
	comment := strings.TrimSpace(req.Comment)
	if utf8.RuneCountInString(comment) > domain.FeedbackMaxComment {
		badRequest(c, "comment must be at most 1000 characters")
		return
	}
	if err := h.store.Submit(c.Request.Context(), userID(c), *req.Rating, comment); err != nil {
		writeError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

// Dismiss handles POST /api/feedback/dismiss → 204 (the window was closed without a rating).
func (h *FeedbackHandler) Dismiss(c *gin.Context) {
	if err := h.store.Dismiss(c.Request.Context(), userID(c)); err != nil {
		writeError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}
