package domain

import "testing"

func TestIsWordLearned(t *testing.T) {
	cases := []struct {
		name               string
		boxLevel           int
		correctStreakAtMax int
		want               bool
	}{
		{"below the learned box entirely", LearnedMinBox - 1, 99, false},
		{"at the learned box but streak not yet met", LearnedMinBox, LearnedStreak - 1, false},
		{"at the learned box with exactly the required streak", LearnedMinBox, LearnedStreak, true},
		{"at the learned box with more than the required streak", LearnedMinBox, LearnedStreak + 3, true},
		{"well below the box even with a huge streak", 1, 100, false},
	}
	for _, c := range cases {
		if got := IsWordLearned(c.boxLevel, c.correctStreakAtMax); got != c.want {
			t.Errorf("%s: IsWordLearned(%d, %d) = %v, want %v", c.name, c.boxLevel, c.correctStreakAtMax, got, c.want)
		}
	}
}
