package service

import (
	"testing"
	"time"

	"learnwords/internal/domain"
)

// This is exactly the reported bug, traced through the real write path: a word that reaches
// LearnedMinBox is NOT yet "learned" (hero/stats/filter must all agree it is NOT) until it has
// also survived LearnedStreak consecutive correct answers there. ApplyAnswer's resulting
// IsLearned flag — the single value hero/stats/the collection filter all read — must always
// match domain.IsWordLearned for the same (box, streak), so they can never disagree again.
func TestApplyAnswer_MatchesSharedLearnedDefinition(t *testing.T) {
	now := time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)
	p := domain.Progress{BoxLevel: domain.LearnedMinBox - 1} // one answer away from the learned box

	// Reaching the learned box for the first time: not learned yet (streak resets to 0 here).
	p = ApplyAnswer(p, true, now)
	if p.BoxLevel != domain.LearnedMinBox {
		t.Fatalf("box_level = %d, want %d", p.BoxLevel, domain.LearnedMinBox)
	}
	if p.IsLearned || domain.IsWordLearned(p.BoxLevel, p.CorrectStreakAtMax) {
		t.Fatalf("word must not be learned on first reaching box %d", domain.LearnedMinBox)
	}

	// Each correct answer at the learned box builds the streak; must stay "not learned" and
	// stay in agreement with the shared predicate right up until LearnedStreak is reached.
	for i := 1; i < domain.LearnedStreak; i++ {
		p = ApplyAnswer(p, true, now)
		if p.IsLearned {
			t.Fatalf("after %d correct streak answers: IsLearned=true too early (need %d)", i, domain.LearnedStreak)
		}
		if domain.IsWordLearned(p.BoxLevel, p.CorrectStreakAtMax) != p.IsLearned {
			t.Fatalf("domain.IsWordLearned disagrees with ApplyAnswer's IsLearned at streak %d", i)
		}
	}

	// The LearnedStreak-th correct answer in a row at the learned box: now it's learned.
	p = ApplyAnswer(p, true, now)
	if !p.IsLearned {
		t.Fatalf("word must be learned after %d consecutive correct answers at box %d", domain.LearnedStreak, domain.LearnedMinBox)
	}
	if !domain.IsWordLearned(p.BoxLevel, p.CorrectStreakAtMax) {
		t.Fatal("domain.IsWordLearned must agree the word is now learned")
	}

	// A single wrong answer drops it straight back to "not learned", box 1 — hero/stats/filter
	// must all stop counting it immediately.
	p = ApplyAnswer(p, false, now)
	if p.IsLearned || domain.IsWordLearned(p.BoxLevel, p.CorrectStreakAtMax) {
		t.Fatal("a wrong answer must un-learn the word")
	}
}

// A word merely sitting at a box below LearnedMinBox is never learned, regardless of any
// leftover streak counter (defensive — this combination shouldn't occur in practice).
func TestIsWordLearned_NeverTrueBelowLearnedMinBox(t *testing.T) {
	for box := 1; box < domain.LearnedMinBox; box++ {
		if domain.IsWordLearned(box, 999) {
			t.Errorf("box %d must never count as learned, no matter the streak", box)
		}
	}
}
