package domain

// LearnedMinBox is the Leitner box a word must reach — and then hold with LearnedStreak
// consecutive correct answers in a row (see service.ApplyAnswer) — to count as "learned"
// everywhere in the app: the hero, the stats page, and the Collection "Выучено" filter all
// share this single definition instead of each re-deciding it. Do not reconstruct this
// condition from box_level alone in SQL — word_progress.is_learned is already the correctly
// maintained, authoritative flag; query that column directly.
const LearnedMinBox = 5

// LearnedStreak: consecutive correct answers required at LearnedMinBox before a word flips
// to learned.
const LearnedStreak = 2

// IsWordLearned mirrors word_progress.is_learned exactly, for the rare case where the flag
// itself isn't already at hand (e.g. computing it from a fresh box/streak pair in Go code).
func IsWordLearned(boxLevel, correctStreakAtMax int) bool {
	return boxLevel >= LearnedMinBox && correctStreakAtMax >= LearnedStreak
}
