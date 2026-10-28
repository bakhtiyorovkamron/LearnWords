package domain

import "time"

// Feedback limits.
const (
	FeedbackMinRating  = 1
	FeedbackMaxRating  = 5
	FeedbackMaxComment = 1000 // runes
	// FeedbackAfter: users are asked once their account is at least this old.
	FeedbackAfter = 48 * time.Hour
)

// FeedbackItem is one rating in the admin list (dismissed windows are not listed).
type FeedbackItem struct {
	Email     string    `json:"email"`
	Rating    int       `json:"rating"`
	Comment   string    `json:"comment"`
	CreatedAt time.Time `json:"created_at"`
}

// FeedbackSummary is the admin view: Average of the ratings (1 decimal, 0 with none), newest first.
type FeedbackSummary struct {
	Average float64        `json:"average"`
	Count   int            `json:"count"`
	Items   []FeedbackItem `json:"items"`
}
