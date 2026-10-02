package domain

import (
	"time"

	"github.com/google/uuid"
)

// StoryWord is a word (with translation) that a daily story is built from.
type StoryWord struct {
	Word        string `json:"word"`
	Translation string `json:"translation"`
}

// DailyStory is an AI-generated German story using the words a user added on a given day.
type DailyStory struct {
	ID        uuid.UUID   `json:"id"`
	UserID    uuid.UUID   `json:"-"`
	Date      string      `json:"date"` // YYYY-MM-DD
	Genre     string      `json:"genre"`
	Title     string      `json:"title"`
	StoryDE   string      `json:"story_de"`
	StoryRU   string      `json:"story_ru"`
	WordsUsed []StoryWord `json:"words_used"`
	CreatedAt time.Time   `json:"created_at"`
}

// GeneratedStory is the raw LLM output.
type GeneratedStory struct {
	Title   string `json:"title"`
	StoryDE string `json:"story_de"`
	StoryRU string `json:"story_ru"`
}
