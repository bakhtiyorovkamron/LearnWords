package domain

// MaxDeleteWords is how many words one POST /api/words/delete may carry.
const MaxDeleteWords = 500

// DeleteResult is the POST /api/words/delete answer.
type DeleteResult struct {
	Deleted int `json:"deleted"`
}
