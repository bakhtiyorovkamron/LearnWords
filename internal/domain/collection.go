package domain

import "time"

// CollectionCard is a word card with its Leitner progress (for the "Collection" page).
type CollectionCard struct {
	WordCard
	BoxLevel  int  `json:"box_level"`
	IsLearned bool `json:"is_learned"`
	// NextReviewAt: date (UTC midnight) of the next Leitner review; today for a word that has no
	// progress yet (it is due right away).
	NextReviewAt time.Time `json:"next_review_at"`
	// ReviewedToday: the word was answered in a Leitner review today (UTC). Extra practice does
	// not count — it never touches the schedule.
	ReviewedToday bool `json:"reviewed_today"`
}

// CollectionFilter: Status "" | all | new | learning | learned; Period "" | all | today | week;
// Sort "" | date | alpha | progress; Q — substring of word or translation.
type CollectionFilter struct {
	Status string
	Period string
	Sort   string
	Q      string
	Folder *FolderFilter // nil = all words
	Limit  int
	Offset int
}
