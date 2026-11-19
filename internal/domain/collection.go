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
	// RepeatMarked: the user marked the word "review later" on the deck and has not answered it
	// in a review since.
	RepeatMarked bool `json:"repeat_marked"`
}

// CollectionFilter: Status "" | all | new | learning | learned; Period "" | all | today | week;
// Sort "" | date | alpha | progress | repeat; Q — substring of word or translation.
type CollectionFilter struct {
	Status string
	Period string
	Sort   string
	// MarksBefore (sort=repeat): only marks made at or before it put a word first, so marking while
	// a deck is open never reorders the pages it is still loading.
	MarksBefore time.Time
	Q           string
	Folder      *FolderFilter // nil = all words
	Limit       int
	Offset      int
}
