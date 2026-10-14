package domain

import "time"

// Hero moods, computed on the server (see service.heroMood).
const (
	HeroIdle   = "idle"
	HeroSleepy = "sleepy" // words are due today and there was no training yet today
	HeroHappy  = "happy"  // trained today and nothing is due any more
	HeroSad    = "sad"    // the streak broke yesterday (shown on that first day only)
)

// HeroPhrase is what the hero says: German + translation into the interface language.
type HeroPhrase struct {
	De          string `json:"de"`
	Translation string `json:"translation"`
}

// HeroWord is a learned German word as the phrase builder sees it.
type HeroWord struct {
	Word         string // as saved: "der Hund", "Hund", "laufen"
	Lemma        string // from the word check, may be empty
	Article      string // from the word check, may be empty
	PartOfSpeech string // from the word check, may be empty
	Translation  string // in the requested interface language; empty if not known yet
}

// Hero is the "German hero" growth card: a gamified summary of how much German vocabulary a
// user has actually learned (not just added). See service.HeroService for how it's computed.
type Hero struct {
	Stage            int        `json:"stage"`      // 1-6 (the UI draws stage-1: 0 Little Mozart … 5 Goethe)
	StageName        string     `json:"stage_name"` // in the requested interface language
	LearnedCount     int        `json:"learned_count"`
	AlmostCount      int        `json:"almost_count"`        // words at box LearnedMinBox-1 ("almost learned")
	WordsToNextStage int        `json:"words_to_next_stage"` // 0 at the max stage
	BornAt           time.Time  `json:"born_at"`             // account creation date
	AgeDays          int        `json:"age_days"`
	BirthdayToday    bool       `json:"birthday_today"` // today is an anniversary of BornAt, in Asia/Tashkent
	Mood             string     `json:"mood"`
	Phrase           HeroPhrase `json:"phrase"`
	// StageUp: the hero reached a stage whose congratulation the user hasn't seen yet. Stays true
	// until POST /api/hero/stage-seen.
	StageUp bool `json:"stage_up"`
}
