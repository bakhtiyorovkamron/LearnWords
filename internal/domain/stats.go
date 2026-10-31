package domain

// DayStat is the learning activity for one calendar day (UTC).
type DayStat struct {
	Date     string `json:"date"` // YYYY-MM-DD
	Reviewed int    `json:"reviewed"`
	Correct  int    `json:"correct"`
	NewWords int    `json:"new_words"`
	// Active: any answer that day (review or practice — the streak rule). GoalMet: the daily goal was reached.
	Active  bool `json:"active"`
	GoalMet bool `json:"goal_met"`
}

type StatsTotals struct {
	TotalWordsLearned int `json:"total_words_learned"`
	CurrentStreakDays int `json:"current_streak_days"`
	LongestStreakDays int `json:"longest_streak_days"`
	AccuracyPercent   int `json:"accuracy_percent"`
}

type Stats struct {
	Daily  []DayStat   `json:"daily"`
	Totals StatsTotals `json:"totals"`
}
