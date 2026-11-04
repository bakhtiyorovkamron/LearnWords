package main

import (
	"bytes"
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
)

type fakeStore struct {
	cards []card
	saved map[uuid.UUID]string
}

func (f *fakeStore) Pending(_ context.Context, after uuid.UUID, limit int) ([]card, error) {
	var out []card
	for _, c := range f.cards {
		if c.ID.String() > after.String() && len(out) < limit {
			out = append(out, c)
		}
	}
	return out, nil
}

func (f *fakeStore) Save(_ context.Context, id uuid.UUID, answer string) error {
	f.saved[id] = answer
	return nil
}

type fakeAI map[string]string // word → answer ("" = error)

func (a fakeAI) GapForm(_ context.Context, _, word string) (string, error) {
	if a[word] == "" {
		return "", errors.New("boom")
	}
	return a[word], nil
}

func fixture() *fakeStore {
	mk := func(n byte, word string) card {
		return card{ID: uuid.UUID{15: n}, Word: word, Sentence: "Die Suppe ___ gut.", Language: "de"}
	}
	return &fakeStore{saved: map[uuid.UUID]string{}, cards: []card{mk(1, "schmecken"), mk(2, "gut"), mk(3, "kaputt")}}
}

var ai = fakeAI{"schmecken": "schmeckt", "gut": "gut"} // "kaputt" fails

func TestRun_DryRunWritesNothing(t *testing.T) {
	s := fixture()
	var out bytes.Buffer
	st, err := run(context.Background(), s, ai, false, time.Millisecond, &out)
	if err != nil || len(s.saved) != 0 {
		t.Fatalf("dry run saved %v, %v", s.saved, err)
	}
	if st.Asked != 3 || st.Skipped != 1 || st.Failed != 1 || st.Written != 0 {
		t.Errorf("stats: %+v", st)
	}
	if !bytes.Contains(out.Bytes(), []byte(`"schmeckt"`)) {
		t.Errorf("dry run should print what it would write: %s", out.String())
	}
}

func TestRun_ApplyWritesChangedFormsOnly(t *testing.T) {
	s := fixture()
	st, err := run(context.Background(), s, ai, true, time.Millisecond, &bytes.Buffer{})
	if err != nil {
		t.Fatal(err)
	}
	if len(s.saved) != 1 || s.saved[uuid.UUID{15: 1}] != "schmeckt" || st.Written != 1 {
		t.Errorf("saved %v, stats %+v (the word itself is skipped, a failed card is not written)", s.saved, st)
	}
}
