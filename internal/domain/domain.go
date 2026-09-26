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

// Context is user-uploaded content (screenshot or text) that words are extracted from.
type Context struct {
	ID         uuid.UUID `json:"id"`
	UserID     uuid.UUID `json:"user_id"`
	ImageURL   *string   `json:"image_url,omitempty"`
	SourceText string    `json:"source_text"`
	Language   string    `json:"language"`
	CreatedAt  time.Time `json:"created_at"`
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

type TokenPair struct {
	AccessToken      string    `json:"access_token"`
	RefreshToken     string    `json:"refresh_token"`
	AccessExpiresAt  time.Time `json:"access_expires_at"`
	RefreshExpiresAt time.Time `json:"refresh_expires_at"`
}
