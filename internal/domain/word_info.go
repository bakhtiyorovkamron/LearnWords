package domain

// WordInfo is the AI "dictionary entry" for a searched word (not stored as such).
type WordInfo struct {
	Word               string             `json:"word"`
	WordType           string             `json:"word_type"` // noun | verb | adjective | adverb | other
	Article            *string            `json:"article"`
	Plural             *string            `json:"plural"`
	Translation        string             `json:"translation"`
	Pronunciation      string             `json:"pronunciation"`
	VerbType           *string            `json:"verb_type"` // weak | strong
	ConjugationPresent *map[string]string `json:"conjugation_present"`
	Perfekt            *string            `json:"perfekt"`
	Praeteritum        *string            `json:"praeteritum"`
	Comparative        *string            `json:"comparative"`
	Superlative        *string            `json:"superlative"`
	ExampleSentence    string             `json:"example_sentence"`
	ExampleTranslation string             `json:"example_translation"`

	// Filled by the backend: the word (with article for nouns) is already in the user's collection.
	AlreadyAdded bool `json:"already_added"`
}

// FullWord is the form stored in the collection: "der Hund" for nouns, otherwise the word itself.
func (w WordInfo) FullWord() string {
	if w.WordType == "noun" && w.Article != nil && *w.Article != "" {
		return *w.Article + " " + w.Word
	}
	return w.Word
}
