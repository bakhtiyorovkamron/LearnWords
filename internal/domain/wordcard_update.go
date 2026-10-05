package domain

// WordCardUpdate is a partial edit of a card's content; nil = keep the current value.
type WordCardUpdate struct {
	Word               *string `json:"word"`
	Translation        *string `json:"translation"`
	Transcription      *string `json:"transcription"`
	ExampleSentence    *string `json:"example_sentence"`
	ExampleTranslation *string `json:"example_translation"`
}
