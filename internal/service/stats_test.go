package service

import (
	"testing"
	"time"
)

func day(s string) time.Time {
	t, _ := time.Parse("2006-01-02", s)
	return t
}

func TestStreaks(t *testing.T) {
	today := day("2026-10-02")
	cases := []struct {
		name             string
		days             []string // newest first
		current, longest int
	}{
		{"empty", nil, 0, 0},
		{"today only", []string{"2026-10-02"}, 1, 1},
		{"through yesterday", []string{"2026-10-01", "2026-09-30", "2026-09-29"}, 3, 3},
		{"broken: last activity two days ago", []string{"2026-09-30", "2026-09-29"}, 0, 2},
		{"gap", []string{"2026-10-02", "2026-10-01", "2026-09-28", "2026-09-27", "2026-09-26", "2026-09-25"}, 2, 4},
	}
	for _, c := range cases {
		var days []time.Time
		for _, s := range c.days {
			days = append(days, day(s))
		}
		cur, lon := Streaks(days, today)
		if cur != c.current || lon != c.longest {
			t.Errorf("%s: got %d/%d, want %d/%d", c.name, cur, lon, c.current, c.longest)
		}
	}
}
