package domain

import (
	"errors"
	"strings"
)

// PhotoWord is a word read off a photo, not saved yet. Saved by the user through the usual
// "add word" call (POST /search-word/add) with FullWord and Translation.
type PhotoWord struct {
	Word        string  `json:"word"`
	Article     *string `json:"article"`
	WordType    string  `json:"word_type"` // noun | verb | adjective | adverb | phrase | other
	Translation string  `json:"translation"`
	// Filled by the backend.
	FullWord     string `json:"full_word"`     // "der Hund" for nouns with an article, otherwise Word
	AlreadyAdded bool   `json:"already_added"` // already in the user's collection
}

// PhotoImportResult is the answer of a photo import. Remaining is what is left of today's
// photo quota (nil = unlimited).
type PhotoImportResult struct {
	Words     []PhotoWord `json:"words"`
	Remaining *int        `json:"remaining"`
}

// Full returns the stored spelling of w: the article joins nouns only.
func (w PhotoWord) Full() string {
	if w.Article != nil && w.WordType == "noun" {
		if a := strings.TrimSpace(*w.Article); a != "" {
			return a + " " + strings.TrimSpace(w.Word)
		}
	}
	return strings.TrimSpace(w.Word)
}

// What the AI decided about a photo.
const (
	PhotoOK          = "ok"
	PhotoNotDocument = "not_document" // no learning material / no text in the learning language
	PhotoUnreadable  = "unreadable"   // text is there but too small, blurred, cut off or skewed
)

// PhotoReading is the AI's answer for a photo: its verdict and, for "ok", the words.
type PhotoReading struct {
	Status string
	Words  []PhotoWord
}

// A rejected photo is never charged (the quota unit is given back).
var (
	ErrPhotoNotDocument = errors.New("photo is not study material")
	ErrPhotoUnreadable  = errors.New("photo text is unreadable")
)
