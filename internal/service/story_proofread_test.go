package service

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"

	"learnwords/internal/domain"
)

type fakeStoryGen struct {
	got   []domain.StoryWord
	story domain.GeneratedStory
}

func (g *fakeStoryGen) GenerateStory(_ context.Context, words []domain.StoryWord, _ string) (domain.GeneratedStory, error) {
	g.got = words
	return g.story, nil
}

// fakeProofreader returns its answers in order (an error entry simulates a timeout/invalid JSON).
type fakeProofreader struct {
	answers []any // domain.ProofreadStory or error
	calls   int
}

func (p *fakeProofreader) ProofreadStory(context.Context, string, string, []domain.StoryWord) (domain.ProofreadStory, error) {
	a := p.answers[min(p.calls, len(p.answers)-1)]
	p.calls++
	if err, ok := a.(error); ok {
		return domain.ProofreadStory{}, err
	}
	return a.(domain.ProofreadStory), nil
}

var (
	rawStory = domain.GeneratedStory{Title: "Die magische Stift", StoryDE: "Anna hat **die magische Stift**. **Sie komme** heute nach Hause."}
	fixed    = domain.ProofreadStory{
		Title: "Der magische Stift",
		Text:  "Anna hat **den magischen Stift**. Sie **kommt** heute nach Hause.",
		Corrections: []domain.StoryCorrection{
			{From: "die magische Stift", To: "den magischen Stift", Why: "gender + accusative"},
			{From: "Sie komme", To: "Sie kommt", Why: "agreement"},
		},
		WordForms: map[string][]string{"der Stift": {"Stift"}, "kommen": {"kommt", "kommen"}},
	}
	storyWords = []domain.StoryWord{
		{Word: "Sfit", Lemma: "Stift", Article: "der", PartOfSpeech: "noun"},
		{Word: "komme", Lemma: "kommen", PartOfSpeech: "verb"},
	}
)

func newProofStory(p *fakeProofreader) (*StoryService, *fakeStoryRepo, *fakeStoryGen) {
	repo := newFakeStoryRepo()
	repo.words = append([]domain.StoryWord(nil), storyWords...)
	gen := &fakeStoryGen{story: rawStory}
	var proof StoryProofreader
	if p != nil {
		proof = p
	}
	return NewStoryService(repo, gen, nil, proof), repo, gen
}

func TestStory_ProofreadTextIsSaved(t *testing.T) {
	p := &fakeProofreader{answers: []any{fixed}}
	svc, repo, gen := newProofStory(p)

	st, err := svc.generateFor(deCtx(), uuid.New(), "2026-10-14", "сказка", "")
	if err != nil {
		t.Fatal(err)
	}
	if gen.got[0].PromptForm() != "der Stift" || gen.got[1].PromptForm() != "kommen" {
		t.Fatalf("generator got %+v, want lemma + article", gen.got)
	}
	if st.Title != "Der magische Stift" || st.StoryDE != fixed.Text || st.ProofreadStatus != domain.ProofreadChecked {
		t.Fatalf("saved %+v", st)
	}
	if len(repo.corrections) != 2 {
		t.Fatalf("corrections saved: %d", len(repo.corrections))
	}
	// "kommen" doesn't occur in the text → only the real form is kept.
	if f := st.WordsUsed[1].Forms; len(f) != 1 || f[0] != "kommt" {
		t.Fatalf("forms of kommen = %v", f)
	}
	if f := st.WordsUsed[0].Forms; len(f) != 1 || f[0] != "Stift" {
		t.Fatalf("forms of der Stift = %v", f)
	}
}

func TestStory_ProofreadRetriedOnce(t *testing.T) {
	p := &fakeProofreader{answers: []any{errors.New("timeout"), fixed}}
	svc, _, _ := newProofStory(p)
	st, err := svc.generateFor(deCtx(), uuid.New(), "2026-10-14", "", "")
	if err != nil {
		t.Fatal(err)
	}
	if p.calls != 2 || st.StoryDE != fixed.Text || st.ProofreadStatus != domain.ProofreadChecked {
		t.Fatalf("calls=%d status=%s text=%q", p.calls, st.ProofreadStatus, st.StoryDE)
	}
}

func TestStory_ProofreadFailsTwice_OriginalShown(t *testing.T) {
	p := &fakeProofreader{answers: []any{errors.New("invalid JSON")}}
	svc, repo, _ := newProofStory(p)
	st, err := svc.generateFor(deCtx(), uuid.New(), "2026-10-14", "", "")
	if err != nil {
		t.Fatal(err)
	}
	if p.calls != 2 {
		t.Fatalf("proofreader called %d times, want 2", p.calls)
	}
	if st.StoryDE != rawStory.StoryDE || st.Title != rawStory.Title || st.ProofreadStatus != domain.ProofreadFailed {
		t.Fatalf("got %+v", st)
	}
	if len(repo.corrections) != 0 {
		t.Fatal("no corrections expected")
	}
}

func TestStory_SuspiciousProofreadRejected(t *testing.T) {
	short := fixed
	short.Text = "Anna hat einen Stift."
	lostBold := fixed
	lostBold.Text = "Anna hat den magischen Stift. Sie kommt heute nach Hause, ja."
	for name, bad := range map[string]domain.ProofreadStory{"too short": short, "bold dropped": lostBold} {
		p := &fakeProofreader{answers: []any{bad}}
		svc, _, _ := newProofStory(p)
		st, err := svc.generateFor(deCtx(), uuid.New(), "2026-10-14", "", "")
		if err != nil {
			t.Fatal(err)
		}
		if st.StoryDE != rawStory.StoryDE || st.ProofreadStatus != domain.ProofreadFailed {
			t.Errorf("%s: proofread answer was accepted: %q", name, st.StoryDE)
		}
	}
}

func TestStory_NoProofreader(t *testing.T) {
	svc, _, _ := newProofStory(nil)
	st, err := svc.generateFor(deCtx(), uuid.New(), "2026-10-14", "", "")
	if err != nil || st.StoryDE != rawStory.StoryDE || st.ProofreadStatus != domain.ProofreadNone {
		t.Fatalf("got %+v %v", st, err)
	}
}
