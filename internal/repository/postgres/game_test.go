package postgres

import (
	"context"
	"testing"

	"github.com/google/uuid"

	"learnwords/internal/domain"
)

type gameFixture struct {
	moveFixture
	games *GameRepository
}

func newGameFixture(t *testing.T) gameFixture {
	f := newMoveFixture(t)
	return gameFixture{f, NewGameRepository(f.pool)}
}

func (f gameFixture) save(t *testing.T, user uuid.UUID, key, game string, score int, of *int) (domain.GameRecord, bool, *int) {
	t.Helper()
	spec, ok := domain.GameByName(game)
	if !ok {
		t.Fatalf("no game %q", game)
	}
	rec, isNew, prev, err := f.games.SaveResult(context.Background(), user, key, spec, score, of)
	if err != nil {
		t.Fatal(err)
	}
	return rec, isNew, prev
}

func (f gameFixture) records(t *testing.T, user uuid.UUID, key string) map[string]domain.GameRecord {
	t.Helper()
	recs, err := f.games.Records(context.Background(), user, key)
	if err != nil {
		t.Fatal(err)
	}
	out := map[string]domain.GameRecord{}
	for _, r := range recs {
		out[r.Game] = r
	}
	return out
}

func TestGameRecords_BestKept_PlaysCounted(t *testing.T) {
	f := newGameFixture(t)
	of := func(n int) *int { return &n }

	if rec, isNew, prev := f.save(t, f.user, "all", domain.GamePairs, 40_000, nil); !isNew || prev != nil || rec.Best != 40_000 || rec.Plays != 1 || rec.BestOf != nil {
		t.Errorf("first: %+v %v %v", rec, isNew, prev)
	}
	if rec, isNew, prev := f.save(t, f.user, "all", domain.GamePairs, 52_000, nil); isNew || prev != nil || rec.Best != 40_000 || rec.Plays != 2 {
		t.Errorf("slower: %+v %v %v", rec, isNew, prev)
	}
	if rec, isNew, _ := f.save(t, f.user, "all", domain.GamePairs, 40_000, nil); isNew || rec.Best != 40_000 || rec.Plays != 3 {
		t.Errorf("tie: %+v %v", rec, isNew)
	}
	if rec, isNew, prev := f.save(t, f.user, "all", domain.GamePairs, 33_500, nil); !isNew || prev == nil || *prev != 40_000 || rec.Best != 33_500 || rec.Plays != 4 {
		t.Errorf("faster: %+v %v %v", rec, isNew, prev)
	}

	f.save(t, f.user, "all", domain.GameArticles, 12, of(20))
	if rec, isNew, prev := f.save(t, f.user, "all", domain.GameArticles, 17, of(19)); !isNew || *prev != 12 || rec.Best != 17 || *rec.BestOf != 19 {
		t.Errorf("articles better: %+v %v %v", rec, isNew, prev)
	}
	f.save(t, f.user, "all", domain.GameArticles, 5, of(20))

	got := f.records(t, f.user, "all")
	if p := got[domain.GamePairs]; len(got) != 2 || p.Best != 33_500 || p.Plays != 4 || p.BestOf != nil {
		t.Errorf("pairs as stored: %+v", got)
	}
	if a := got[domain.GameArticles]; a.Best != 17 || a.BestOf == nil || *a.BestOf != 19 || a.Plays != 3 {
		t.Errorf("articles as stored: %+v", a)
	}
}

func TestGameRecords_SeparatePerFolderAndUser(t *testing.T) {
	f := newGameFixture(t)
	other := newMoveFixture(t).user
	folder := f.folder(t, f.user).String()

	f.save(t, f.user, "all", domain.GamePairs, 40_000, nil)
	f.save(t, f.user, folder, domain.GamePairs, 60_000, nil)
	f.save(t, other, "all", domain.GamePairs, 20_000, nil)

	if got := f.records(t, f.user, "all"); got[domain.GamePairs].Best != 40_000 || got[domain.GamePairs].Plays != 1 {
		t.Errorf("all: %+v", got)
	}
	if got := f.records(t, f.user, folder); got[domain.GamePairs].Best != 60_000 || got[domain.GamePairs].Plays != 1 {
		t.Errorf("folder: %+v", got)
	}
	if got := f.records(t, f.user, "none"); len(got) != 0 {
		t.Errorf("none: %+v", got)
	}
	if got := f.records(t, other, "all"); got[domain.GamePairs].Best != 20_000 {
		t.Errorf("the other user: %+v", got)
	}
	if recs, err := f.games.Records(context.Background(), uuid.New(), "all"); err != nil || recs == nil || len(recs) != 0 {
		t.Errorf("nobody: %v %v (an empty list, not null)", recs, err)
	}
}

func TestGameRecords_FolderOwned(t *testing.T) {
	f := newGameFixture(t)
	other := newMoveFixture(t).user
	mine, theirs := f.folder(t, f.user), f.folder(t, other)
	ctx := context.Background()
	for id, want := range map[uuid.UUID]bool{mine: true, theirs: false, uuid.New(): false} {
		if ok, err := f.games.FolderOwned(ctx, f.user, id); err != nil || ok != want {
			t.Errorf("%s: %v %v, want %v", id, ok, err, want)
		}
	}
}
