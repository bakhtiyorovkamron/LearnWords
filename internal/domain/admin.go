package domain

import (
	"time"

	"github.com/google/uuid"
)

// AdminUser is a row of the admin users table.
type AdminUser struct {
	ID             uuid.UUID  `json:"id"`
	Email          string     `json:"email"`
	Role           string     `json:"role"`
	IsBanned       bool       `json:"is_banned"`
	CreatedAt      time.Time  `json:"created_at"`
	WordsCount     int        `json:"words_count"`
	LastActivityAt *time.Time `json:"last_activity_at"`
}

// AdminStats are service-wide totals for the admin dashboard.
type AdminStats struct {
	TotalUsers       int `json:"total_users"`
	BannedUsers      int `json:"banned_users"`
	NewUsers7d       int `json:"new_users_7d"`
	ActiveUsers7d    int `json:"active_users_7d"`
	TotalWords       int `json:"total_words"`
	TotalReviews     int `json:"total_reviews"`     // individual training answers
	TrainingSessions int `json:"training_sessions"` // distinct (user, day) with at least one answer
	TotalStories     int `json:"total_stories"`     // AI stories generated (Anthropic usage)
	Stories30d       int `json:"stories_30d"`
}
