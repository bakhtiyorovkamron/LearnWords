package domain

import (
	"errors"

	"github.com/google/uuid"
)

// MaxSharedWords caps both the public preview and what one import copies.
const MaxSharedWords = 500

// SharedWord is a word of a shared folder as the public sees it: no ids, no progress, no owner.
type SharedWord struct {
	Word               string  `json:"word"`
	Article            *string `json:"article"`
	Translation        string  `json:"translation"`
	Transcription      string  `json:"transcription"`
	ExampleSentence    string  `json:"example_sentence"`
	ExampleTranslation string  `json:"example_translation"`
}

// SharedFolder is GET /api/shared/:token. Nothing in it identifies the owner.
type SharedFolder struct {
	Name      string       `json:"name"`
	Color     string       `json:"color"`
	Language  string       `json:"language"`
	WordCount int          `json:"word_count"` // all words, even when Words is capped
	Words     []SharedWord `json:"words"`
}

// ShareInfo is the answer to enabling / regenerating a link.
type ShareInfo struct {
	Token string `json:"token"`
	URL   string `json:"url"`
}

// ImportResult is the answer to importing a shared folder.
type ImportResult struct {
	FolderID uuid.UUID `json:"folder_id"`
	Added    int       `json:"added"`
	Skipped  int       `json:"skipped"` // words the user already had
}

// OwnFolderError is returned when the caller imports their own folder; it carries the folder's id
// so the client can open it. It matches ErrOwnFolder.
type OwnFolderError struct{ FolderID uuid.UUID }

func (e *OwnFolderError) Error() string { return ErrOwnFolder.Error() }
func (e *OwnFolderError) Unwrap() error { return ErrOwnFolder }

// IsOwnFolder extracts the folder id from an own-folder error.
func IsOwnFolder(err error) (uuid.UUID, bool) {
	var e *OwnFolderError
	if errors.As(err, &e) {
		return e.FolderID, true
	}
	return uuid.Nil, false
}
