package service

import (
	"context"
	"sort"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	"learnwords/internal/domain"
)

type fakeWordFixRepo struct {
	mu          sync.Mutex
	cards       []domain.CardToCheck
	grammar     map[uuid.UUID]domain.WordGrammar
	suggestions []domain.WordFix
}

func (r *fakeWordFixRepo) CardsToCheck(_ context.Context, after uuid.UUID, limit int) ([]domain.CardToCheck, error) {
	sort.Slice(r.cards, func(i, j int) bool { return r.cards[i].ID.String() < r.cards[j].ID.String() })
	var out []domain.CardToCheck
	for _, c := range r.cards {
		if c.ID.String() > after.String() && len(out) < limit {
			out = append(out, c)
		}
	}
	return out, nil
}
func (r *fakeWordFixRepo) CountCardsToCheck(context.Context) (int, error) { return len(r.cards), nil }
func (r *fakeWordFixRepo) SetGrammar(_ context.Context, id uuid.UUID, g domain.WordGrammar) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.grammar[id] = g
	return nil
}
func (r *fakeWordFixRepo) AddSuggestion(_ context.Context, s domain.WordFix) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.suggestions = append(r.suggestions, s)
	return nil
}
func (r *fakeWordFixRepo) ListPending(context.Context, uuid.UUID) ([]domain.WordFix, error) {
	return nil, nil
}
func (r *fakeWordFixRepo) Accept(context.Context, uuid.UUID, uuid.UUID) error { return nil }
func (r *fakeWordFixRepo) Reject(context.Context, uuid.UUID, uuid.UUID) error { return nil }

func TestWordFixJob_OnlySuggests(t *testing.T) {
	ai := newFakeWordChecker()
	ai.answers["Sfit"] = []domain.WordCheck{{Status: "corrected", Lemma: "Stift", Article: strp("der"), Plural: strp("Stifte"), PartOfSpeech: "noun", Translation: "ручка", Reason: "опечатка"}}
	ai.answers["Tisch"] = []domain.WordCheck{{Status: "ok", Lemma: "Tisch", Article: strp("der"), PartOfSpeech: "noun", Translation: "стол"}}
	ai.answers["Qwrtz"] = []domain.WordCheck{{Status: "unknown"}}

	sfit, tisch, unknown, variants := uuid.New(), uuid.New(), uuid.New(), uuid.New()
	repo := &fakeWordFixRepo{grammar: map[uuid.UUID]domain.WordGrammar{}, cards: []domain.CardToCheck{
		{ID: sfit, Word: "Sfit", NativeLang: "ru"},
		{ID: tisch, Word: "Tisch", NativeLang: "ru"},
		{ID: unknown, Word: "Qwrtz", NativeLang: "ru"},
		{ID: variants, Word: "der Samstag / der Sonnabend", NativeLang: "ru"},
	}}
	svc := NewWordFixService(repo, NewWordCheckService(ai, nil))
	if started, err := svc.Start(context.Background()); !started || err != nil {
		t.Fatalf("start: %v %v", started, err)
	}
	deadline := time.Now().Add(5 * time.Second)
	for svc.Status().Running && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	st := svc.Status()
	if st.Running || st.Processed != 4 || st.Suggestions != 1 || st.Confirmed != 1 || st.Unknown != 1 {
		t.Fatalf("status %+v", st)
	}
	if len(repo.suggestions) != 1 || repo.suggestions[0].WordID != sfit || repo.suggestions[0].SuggestedWord != "der Stift" ||
		repo.suggestions[0].OriginalWord != "Sfit" {
		t.Fatalf("suggestions %+v", repo.suggestions)
	}
	if g, ok := repo.grammar[tisch]; !ok || g.Lemma != "Tisch" || len(repo.grammar) != 1 {
		t.Fatalf("grammar %+v", repo.grammar)
	}
	if ai.calls["der Samstag / der Sonnabend"] != 0 {
		t.Fatal("variants must not be sent to the check")
	}
}
