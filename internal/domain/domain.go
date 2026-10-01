// Package domain contains core business entities and errors, independent of transport and storage.
package domain

import (
	"errors"
	"time"

	"github.com/google/uuid"
)

var (
	ErrNotFound           = errors.New("not found")
	ErrAlreadyExists      = errors.New("already exists")
	ErrInvalidCredentials = errors.New("invalid credentials")
	ErrUnauthorized       = errors.New("unauthorized")
	ErrValidation         = errors.New("validation error")
)

type User struct {
	ID           uuid.UUID `json:"id"`
	Email        string    `json:"email"`
	PasswordHash string    `json:"-"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

// Context is user-entered text that words are extracted from.
// ImageURL holds an illustrative photo found for the context.
type Context struct {
	ID          uuid.UUID `json:"id"`
	UserID      uuid.UUID `json:"user_id"`
	ImageURL    *string   `json:"image_url,omitempty"`
	PhotoCredit *string   `json:"photo_credit,omitempty"`
	SourceText  string    `json:"source_text"`
	Language    string    `json:"language"`
	CreatedAt   time.Time `json:"created_at"`
}

// Photo is an image search result (licensed for reuse, attribution required).
// URL is a stable, hotlink-safe display URL; Original points to the full-size file.
type Photo struct {
	URL       string `json:"url"`
	Original  string `json:"original"`
	Credit    string `json:"credit"`
	SourceURL string `json:"source_url"`
}

type WordCard struct {
	ID            uuid.UUID `json:"id"`
	ContextID     uuid.UUID `json:"context_id"`
	UserID        uuid.UUID `json:"user_id"`
	Word          string    `json:"word"`
	Translation   string    `json:"translation"`
	Transcription string    `json:"transcription"`
	AudioURL      *string   `json:"audio_url,omitempty"`
	Language      string    `json:"language"`
	CreatedAt     time.Time `json:"created_at"`
}

type ContextWithCards struct {
	Context Context    `json:"context"`
	Cards   []WordCard `json:"cards"`
}

// Progress is the Leitner-box state of a word card.
type Progress struct {
	WordID             uuid.UUID  `json:"word_id"`
	UserID             uuid.UUID  `json:"user_id"`
	BoxLevel           int        `json:"box_level"`
	CorrectStreakAtMax int        `json:"correct_streak_at_max"`
	IsLearned          bool       `json:"is_learned"`
	NextReviewAt       time.Time  `json:"next_review_at"` // date (UTC midnight)
	LastReviewedAt     *time.Time `json:"last_reviewed_at,omitempty"`
}

// DueCard is a word card due for review today.
type DueCard struct {
	WordCard
	BoxLevel int `json:"box_level"`
}
