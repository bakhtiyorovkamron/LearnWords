package domain

import (
	"time"

	"github.com/google/uuid"
)

// Folder is an optional, user-defined group of words. It has no effect on
// training progress, stories or statistics.
type Folder struct {
	ID         uuid.UUID `json:"id"`
	UserID     uuid.UUID `json:"-"`
	Name       string    `json:"name"`
	Color      string    `json:"color"`
	CreatedAt  time.Time `json:"created_at"`
	WordsCount int       `json:"words_count"`
}

// FolderFilter narrows a word list: None = only words without a folder, otherwise ID.
// A nil *FolderFilter means "all words" (the default, unchanged behaviour).
type FolderFilter struct {
	ID   uuid.UUID
	None bool
}
