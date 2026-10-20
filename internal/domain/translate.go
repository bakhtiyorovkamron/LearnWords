package domain

// TranslateRequest is one word to translate into NativeLang by AI.
type TranslateRequest struct {
	LearningLang string // language of Word ("de")
	NativeLang   string // target language (ru | en | uz)
	Word         string
	// ExampleSentence is the FULL sentence (the gap already filled with the word), or "".
	ExampleSentence string
	// KnownMeaning is the card's own translation — the sense the user means — written in
	// KnownMeaningLang ("" when unknown). The translation must express exactly this meaning.
	KnownMeaning     string
	KnownMeaningLang string
}
