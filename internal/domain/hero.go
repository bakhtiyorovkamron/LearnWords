package domain

import "time"

// Hero is the "German hero" growth card: a gamified summary of how much German vocabulary a
// user has actually learned (not just added). See service.HeroService for how it's computed.
type Hero struct {
	Stage            int       `json:"stage"`      // 1-6
	StageName        string    `json:"stage_name"` // in the requested interface language
	LearnedCount     int       `json:"learned_count"`
	WordsToNextStage int       `json:"words_to_next_stage"` // 0 at the max stage
	BornAt           time.Time `json:"born_at"`             // account creation date
	AgeDays          int       `json:"age_days"`
	BirthdayToday    bool      `json:"birthday_today"` // today is an anniversary of BornAt, in Asia/Tashkent
	Phrase           string    `json:"phrase"`
	StageChanged     bool      `json:"stage_changed"` // the max stage grew since the last request
}
