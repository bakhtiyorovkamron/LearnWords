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
	ErrUnavailable        = errors.New("feature unavailable")
	ErrUpstream           = errors.New("upstream service error")
	ErrForbidden          = errors.New("forbidden")
	ErrBanned             = errors.New("account is banned")
	ErrOwnFolder          = errors.New("own folder")                     // importing your own shared folder
	ErrLangMismatch       = errors.New("folder language does not match") // folder is for another learning language
)

const (
	RoleUser  = "user"
	RoleAdmin = "admin"
)

type User struct {
	ID               uuid.UUID `json:"id"`
	Email            string    `json:"email"`
	PasswordHash     string    `json:"-"`
	Role             string    `json:"role"`
	IsBanned         bool      `json:"is_banned"`
	LearningLanguage string    `json:"learning_language"`
	CreatedAt        time.Time `json:"created_at"`
	UpdatedAt        time.Time `json:"updated_at"`
}

// Context is user-entered text that words are extracted from.
// ImageURL holds an illustrative photo found for the context.
type Context struct {
	ID         uuid.UUID `json:"id"`
	UserID     uuid.UUID `json:"user_id"`
	SourceText string    `json:"source_text"`
	Meaning    string    `json:"meaning"`
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

	ExampleSentence    string `json:"example_sentence"`    // sentence with the word replaced by ___
	ExampleTranslation string `json:"example_translation"` // Russian translation of the full sentence

	FolderID *uuid.UUID `json:"folder_id"` // optional grouping; nil = no folder

	// TranslationLanguage: the language Translation / ExampleTranslation are written in (ru | en | uz).
	// nil = unknown (an old card whose translation isn't Cyrillic).
	TranslationLanguage *string `json:"translation_language"`

	// Grammar from the word check, stored next to (never instead of) the text the user typed.
	// nil = not checked (older words, other learning languages, "keep as is").
	Lemma        *string `json:"lemma"`
	Article      *string `json:"article"`
	Plural       *string `json:"plural"`
	PartOfSpeech *string `json:"part_of_speech"`
}

// SetGrammar copies checked grammar onto the card (nil leaves the fields empty).
func (w *WordCard) SetGrammar(g *WordGrammar) {
	if g == nil {
		return
	}
	lemma, pos := g.Lemma, g.PartOfSpeech
	w.Lemma, w.Article, w.Plural, w.PartOfSpeech = &lemma, g.Article, g.Plural, &pos
}

// Example is an AI-generated example sentence for a word.
type Example struct {
	SentenceWithGap string `json:"sentence_with_gap"`
	FullSentence    string `json:"full_sentence"`
	Translation     string `json:"translation"`
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
	BoxLevel   int  `json:"box_level"`
	HasExample bool `json:"has_example"` // example_sentence with a ___ gap → gap-fill question possible
}

type TokenPair struct {
	AccessToken      string    `json:"access_token"`
	RefreshToken     string    `json:"refresh_token"`
	AccessExpiresAt  time.Time `json:"access_expires_at"`
	RefreshExpiresAt time.Time `json:"refresh_expires_at"`
}
