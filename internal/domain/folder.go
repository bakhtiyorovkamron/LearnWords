package domain

import (
	"time"

	"github.com/google/uuid"
)

// FolderStats is a word-progress breakdown: total word count, the same new/learning/learned
// status buckets as the Collection filter, and how many are due for review today. Used both
// for a real folder and for the "all words" / "no folder" synthetic groups.
type FolderStats struct {
	Total         int `json:"total"`
	NewCount      int `json:"new_count"`
	LearningCount int `json:"learning_count"`
	LearnedCount  int `json:"learned_count"`
	DueToday      int `json:"due_today"`
}

// Folder is an optional, user-defined group of words. It has no effect on
// training progress, stories or statistics.
type Folder struct {
	ID        uuid.UUID `json:"id"`
	UserID    uuid.UUID `json:"-"`
	Name      string    `json:"name"`
	Color     string    `json:"color"`
	CreatedAt time.Time `json:"created_at"`
	FolderStats
}

// FolderList is the GET /api/folders response: the user's folders plus the "all words" and
// "no folder" aggregates, computed alongside them (no N+1 — see FolderRepository.List).
type FolderList struct {
	All     FolderStats `json:"all"`
	None    FolderStats `json:"none"`
	Folders []Folder    `json:"folders"`
}

// FolderFilter narrows a word list: None = only words without a folder, otherwise ID.
// A nil *FolderFilter means "all words" (the default, unchanged behaviour).
type FolderFilter struct {
	ID   uuid.UUID
	None bool
}
