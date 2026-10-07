package domain

// CollectionCard is a word card with its Leitner progress (for the "Collection" page).
type CollectionCard struct {
	WordCard
	BoxLevel  int  `json:"box_level"`
	IsLearned bool `json:"is_learned"`
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
