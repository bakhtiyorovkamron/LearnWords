package domain

import "github.com/google/uuid"

// WordCardUpdate is a partial edit of a card's content; nil = keep the current value.
type WordCardUpdate struct {
	Word               *string `json:"word"`
	Translation        *string `json:"translation"`
	Transcription      *string `json:"transcription"`
	ExampleSentence    *string `json:"example_sentence"`
	ExampleTranslation *string `json:"example_translation"`
	// folder_id: absent/null = keep, "" = remove from folder, UUID = move to that folder.
	FolderID *string `json:"folder_id"`

	SetFolder bool       `json:"-"` // filled by the handler from FolderID
	Folder    *uuid.UUID `json:"-"`
}
