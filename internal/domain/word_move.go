package domain

import "github.com/google/uuid"

// MaxMoveWords is how many words one POST /api/words/move may carry.
const MaxMoveWords = 500

// WordFolder is a word with the folder it was in (nil = no folder) — what "undo" needs.
type WordFolder struct {
	WordID   uuid.UUID  `json:"word_id"`
	FolderID *uuid.UUID `json:"folder_id"`
}

// MoveResult is the POST /api/words/move answer.
type MoveResult struct {
	Moved    int          `json:"moved"`
	Previous []WordFolder `json:"previous"`
}
