package domain

// WordInfo is the AI "dictionary entry" for a searched word (not stored as such).
type WordInfo struct {
	Word        string  `json:"word"`
	WordType    string  `json:"word_type"` // noun | verb | adjective | adverb | other
	Article     *string `json:"article"`
	Plural      *string `json:"plural"`
	Translation string  `json:"translation"`
	// Note is an optional grammatical/usage remark in the native language (e.g. "imperative
	// mood", "informal"). Explanations like this must never be appended to Translation itself.
	Note               *string            `json:"note"`
	Pronunciation      string             `json:"pronunciation"`
	VerbType           *string            `json:"verb_type"` // weak | strong
	ConjugationPresent *map[string]string `json:"conjugation_present"`
	Perfekt            *string            `json:"perfekt"`
	Praeteritum        *string            `json:"praeteritum"`
	Comparative        *string            `json:"comparative"`
	Superlative        *string            `json:"superlative"`
	ExampleSentence    string             `json:"example_sentence"`
	ExampleTranslation string             `json:"example_translation"`
	// Other words in the learning language that also match an ambiguous query (with article for nouns).
	Alternatives []string `json:"alternatives"`
	// Language the query was written in as detected by AI: de | ru | uz | en | ...
	QueryLanguage string `json:"query_language"`
	// Language of translation/example_translation (ru | en | uz), set by the backend.
	TranslationLanguage string `json:"translation_language"`

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
