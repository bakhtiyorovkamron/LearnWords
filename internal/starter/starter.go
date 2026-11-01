// Package starter holds the "Introductions" folder every new user gets: 15 everyday phrases in the
// language they learn, with translations in each interface language (ru | en | uz).
package starter

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"strings"
)

//go:embed introductions.json
var introductionsJSON []byte

// Phrase is one starter card. Translation and ExampleTranslation are keyed by interface language.
type Phrase struct {
	Word               string            `json:"word"`
	Transcription      string            `json:"transcription"`
	Translation        map[string]string `json:"translation"`
	Example            string            `json:"example"` // one "___" where the phrase goes
	ExampleTranslation map[string]string `json:"example_translation"`
}

// Content is the whole file.
type Content struct {
	Folder struct {
		Name  map[string]string `json:"name"`
		Color string            `json:"color"`
	} `json:"folder"`
	Languages map[string][]Phrase `json:"languages"`
}

// DefaultNative is used when the requested interface language has no text.
const DefaultNative = "ru"

// Load parses the embedded file.
func Load() (*Content, error) {
	var c Content
	if err := json.Unmarshal(introductionsJSON, &c); err != nil {
		return nil, fmt.Errorf("starter content: %w", err)
	}
	return &c, nil
}

// FolderName is the folder's name in the interface language (Russian when it has none).
func (c *Content) FolderName(native string) string { return pick(c.Folder.Name, native) }

// Phrases are the cards for a learning language (nil when the language has none).
func (c *Content) Phrases(learning string) []Phrase { return c.Languages[strings.ToLower(learning)] }

// Translation is the phrase's translation in the interface language (Russian when it has none).
func (p Phrase) TranslationIn(native string) string { return pick(p.Translation, native) }

// ExampleTranslationIn is the translation of the example sentence in the interface language.
func (p Phrase) ExampleTranslationIn(native string) string { return pick(p.ExampleTranslation, native) }

func pick(m map[string]string, native string) string {
	if v := m[strings.ToLower(native)]; v != "" {
		return v
	}
	return m[DefaultNative]
}
