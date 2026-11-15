package service

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"

	"learnwords/internal/domain"
)

type memQuota struct{ q domain.WordQuota }

func (m memQuota) WordQuota(context.Context, uuid.UUID) (domain.WordQuota, error) { return m.q, nil }

// limitedContextSvc: the add page's service with the limit of 50 on, the user in state q.
func limitedContextSvc(q domain.WordQuota, limit int, botEnabled bool) (*ContextService, *fakeContexts) {
	repo := &fakeContexts{quota: q}
	return NewContextService(repo, nil, Providers{}).WithWordLimit(NewWordLimit(nil, limit, botEnabled)), repo
}

func addWord(svc *ContextService, text string) error {
	_, err := svc.Create(ctxFor("ru"), uuid.New(), CreateContextInput{Text: text, Meaning: "x", ExampleSentence: "Ein ___."})
	return err
}

func TestWordLimit_49PlusOneIsAllowed(t *testing.T) {
	svc, repo := limitedContextSvc(domain.WordQuota{Words: 49}, 50, true)
	if err := addWord(svc, "Hund"); err != nil {
		t.Fatalf("the 50th word must be allowed: %v", err)
	}
	if !repo.guarded || len(repo.saved) != 1 {
		t.Fatalf("guarded %v, saved %d", repo.guarded, len(repo.saved))
	}
}

func TestWordLimit_At50_TelegramRequiredWithLimitAndWords(t *testing.T) {
	svc, repo := limitedContextSvc(domain.WordQuota{Words: 50}, 50, true)
	err := addWord(svc, "Hund")
	if !errors.Is(err, domain.ErrTelegramRequired) {
		t.Fatalf("err = %v, want ErrTelegramRequired", err)
	}
	if limit, words, ok := domain.WordLimitOf(err); !ok || limit != 50 || words != 50 {
		t.Errorf("WordLimitOf = %d, %d, %v; want 50, 50", limit, words, ok)
	}
	if len(repo.saved) != 0 {
		t.Errorf("nothing may be saved, got %d", len(repo.saved))
	}
}

func TestWordLimit_LinkedUserAndAdminHaveNoLimit(t *testing.T) {
	for name, q := range map[string]domain.WordQuota{
		"linked": {Words: 200, TelegramLinked: true},
		"admin":  {Words: 200, Admin: true},
	} {
		svc, repo := limitedContextSvc(q, 50, true)
		if err := addWord(svc, "Hund"); err != nil || len(repo.saved) != 1 {
			t.Errorf("%s: err %v, saved %d", name, err, len(repo.saved))
		}
	}
}

func TestWordLimit_OffWithoutBotOrWithZero(t *testing.T) {
	for name, tc := range map[string]struct {
		limit int
		bot   bool
	}{
		"bot not configured": {50, false},
		"config is 0":        {0, true},
	} {
		svc, repo := limitedContextSvc(domain.WordQuota{Words: 80}, tc.limit, tc.bot)
		if err := addWord(svc, "Hund"); err != nil || len(repo.saved) != 1 {
			t.Errorf("%s: err %v, saved %d", name, err, len(repo.saved))
		}
		if repo.guarded {
			t.Errorf("%s: an inactive rule must not reach the repository (no row lock)", name)
		}
		if l := NewWordLimit(nil, tc.limit, tc.bot); l.Guard() != nil || l.LimitFor(domain.WordQuota{}) != nil {
			t.Errorf("%s: Guard/LimitFor must be nil", name)
		}
	}
	var nilLimit *WordLimit // a service built without the rule
	if nilLimit.Guard() != nil {
		t.Error("a nil *WordLimit must give a nil guard")
	}
}

func TestWordLimit_80WordsCannotAdd_NothingIsTouched(t *testing.T) {
	svc, repo := limitedContextSvc(domain.WordQuota{Words: 80}, 50, true)
	err := addWord(svc, "Hund")
	if limit, words, ok := domain.WordLimitOf(err); !ok || limit != 50 || words != 80 {
		t.Fatalf("err = %v (limit %d words %d)", err, limit, words)
	}
	if repo.quota.Words != 80 {
		t.Errorf("the 80 words stay as they are, got %d", repo.quota.Words)
	}
}

func TestWordLimit_Allow(t *testing.T) {
	l := NewWordLimit(nil, 50, true)
	for _, tc := range []struct {
		words, n int
		ok       bool
	}{
		{0, 50, true}, {0, 51, false}, {49, 1, true}, {49, 2, false}, {50, 1, false},
		{45, 5, true}, {45, 6, false},
		{80, 0, true}, // adding nothing is never blocked
	} {
		err := l.Allow(domain.WordQuota{Words: tc.words}, tc.n)
		if (err == nil) != tc.ok {
			t.Errorf("Allow(%d words, +%d) = %v, want ok=%v", tc.words, tc.n, err, tc.ok)
		}
	}
}

func TestWordLimit_SearchAddGoesThroughTheLimit(t *testing.T) {
	ctxSvc, repo := limitedContextSvc(domain.WordQuota{Words: 50}, 50, true)
	search := NewSearchService(nil, noWords{}, ctxSvc, nil)
	_, err := search.Add(ctxFor("ru"), uuid.New(), AddInput{Word: "der Hund", Translation: "собака"})
	if !errors.Is(err, domain.ErrTelegramRequired) || len(repo.saved) != 0 {
		t.Fatalf("err = %v, saved %d", err, len(repo.saved))
	}
}

type noWords struct{}

func (noWords) HasWord(context.Context, uuid.UUID, ...string) (bool, error) { return false, nil }

func TestWordLimit_StarterFolderCountsAllItsWordsAtOnce(t *testing.T) {
	ok := &memStarterStore{}
	svc, _ := NewStarterService(ok)
	if err := svc.WithWordLimit(NewWordLimit(nil, 50, true)).Create(ctxFor("ru"), uuid.New(), "de"); err != nil || len(ok.items) == 0 {
		t.Fatalf("a starter folder within the limit: %v, %d words", err, len(ok.items))
	}
	small := &memStarterStore{}
	svc, _ = NewStarterService(small)
	err := svc.WithWordLimit(NewWordLimit(nil, len(ok.items)-1, true)).Create(ctxFor("ru"), uuid.New(), "de")
	if !errors.Is(err, domain.ErrTelegramRequired) || small.folder != nil {
		t.Fatalf("a starter folder over the limit is not given (whole): %v, folder %v", err, small.folder)
	}
}

func TestWordLimit_Status(t *testing.T) {
	ctx := context.Background()
	for name, tc := range map[string]struct {
		q     domain.WordQuota
		limit int
		bot   bool
		want  *int
	}{
		"applies":   {domain.WordQuota{Words: 47}, 50, true, ptrInt(50)},
		"linked":    {domain.WordQuota{Words: 47, TelegramLinked: true}, 50, true, nil},
		"admin":     {domain.WordQuota{Words: 47, Admin: true}, 50, true, nil},
		"no bot":    {domain.WordQuota{Words: 47}, 50, false, nil},
		"config 0":  {domain.WordQuota{Words: 47}, 0, true, nil},
		"over (80)": {domain.WordQuota{Words: 80}, 50, true, ptrInt(50)},
	} {
		got, err := NewWordLimit(memQuota{tc.q}, tc.limit, tc.bot).Status(ctx, uuid.New())
		if err != nil {
			t.Fatal(err)
		}
		if got.Count != tc.q.Words || (got.Limit == nil) != (tc.want == nil) || (got.Limit != nil && *got.Limit != *tc.want) {
			t.Errorf("%s: %+v (limit %v)", name, got, got.Limit)
		}
	}
}

func ptrInt(n int) *int { return &n }
