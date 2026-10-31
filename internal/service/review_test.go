package service

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"

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

// --- practice: structural safety -----------------------------------------

type fakeReviewRepoForPractice struct {
	applyCalls int // must stay 0 for every practice answer — Apply is the ONLY thing that
	// ever mutates word_progress (box_level, next_review_at, is_learned).
	logPracticeCalls int
	lastLogCorrect   bool
	practiceWords    []domain.DueCard
	goalChecks       int // MarkGoalDay calls
}

func (f *fakeReviewRepoForPractice) ListDue(context.Context, uuid.UUID, time.Time, int, *domain.FolderFilter) ([]domain.DueCard, error) {
	return nil, nil
}
func (f *fakeReviewRepoForPractice) CountDue(context.Context, uuid.UUID, time.Time, *domain.FolderFilter) (int, error) {
	return 0, nil
}
func (f *fakeReviewRepoForPractice) Apply(context.Context, uuid.UUID, uuid.UUID, time.Time, bool,
	func(domain.Progress) domain.Progress) (*domain.Progress, error) {
	f.applyCalls++
	return &domain.Progress{}, nil
}
func (f *fakeReviewRepoForPractice) PracticeWords(context.Context, uuid.UUID, string, int, *domain.FolderFilter) ([]domain.DueCard, error) {
	return f.practiceWords, nil
}
func (f *fakeReviewRepoForPractice) MarkGoalDay(context.Context, uuid.UUID, time.Time) error {
	f.goalChecks++
	return nil
}
func (f *fakeReviewRepoForPractice) LogPractice(_ context.Context, _, _ uuid.UUID, correct bool) error {
	f.logPracticeCalls++
	f.lastLogCorrect = correct
	return nil
}

// AnswerPractice must call ONLY LogPractice — never Apply — regardless of the answer's
// correctness. This is the "frontend not trusted" guarantee from a different angle: even a
// service-level caller has no way to reach the Leitner-mutating code path through this method.
func TestAnswerPractice_NeverCallsApply(t *testing.T) {
	for _, correct := range []bool{true, false} {
		repo := &fakeReviewRepoForPractice{}
		s := NewReviewService(repo)
		if err := s.AnswerPractice(context.Background(), uuid.New(), uuid.New(), correct); err != nil {
			t.Fatal(err)
		}
		if repo.applyCalls != 0 {
			t.Errorf("correct=%v: Apply was called %d times, want 0", correct, repo.applyCalls)
		}
		if repo.logPracticeCalls != 1 || repo.lastLogCorrect != correct {
			t.Errorf("correct=%v: LogPractice calls=%d, lastCorrect=%v", correct, repo.logPracticeCalls, repo.lastLogCorrect)
		}
	}
}

func TestNormalizePracticeMode(t *testing.T) {
	cases := map[string]string{
		"hard": "hard", "random": "random", "recent": "recent",
		"":        DefaultPracticeMode,
		"HARD":    DefaultPracticeMode, // case-sensitive: only the exact lowercase values are valid
		"easiest": DefaultPracticeMode,
	}
	for in, want := range cases {
		if got := NormalizePracticeMode(in); got != want {
			t.Errorf("NormalizePracticeMode(%q) = %q, want %q", in, got, want)
		}
	}
}

// Only a Leitner answer checks the daily goal; a practice answer never does (it cannot reach the goal).
func TestAnswer_ChecksTheGoal_PracticeNever(t *testing.T) {
	repo := &fakeReviewRepoForPractice{}
	s := NewReviewService(repo)
	if _, err := s.Answer(context.Background(), uuid.New(), uuid.New(), true); err != nil {
		t.Fatal(err)
	}
	if repo.goalChecks != 1 {
		t.Errorf("review answer: %d goal checks, want 1", repo.goalChecks)
	}
	if err := s.AnswerPractice(context.Background(), uuid.New(), uuid.New(), true); err != nil {
		t.Fatal(err)
	}
	if repo.goalChecks != 1 {
		t.Errorf("practice answer checked the goal (%d)", repo.goalChecks)
	}
}
