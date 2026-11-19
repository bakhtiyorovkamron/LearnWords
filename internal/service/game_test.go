package service

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"

	"learnwords/internal/domain"
)

// memGames is a GameRepository in memory, merging results the way the postgres one does.
type memGames struct {
	rows    map[string]domain.GameRecord // user|folder|game
	owned   map[uuid.UUID]uuid.UUID      // folder → owner
	saves   int
	lastKey string
}

func newMemGames() *memGames {
	return &memGames{rows: map[string]domain.GameRecord{}, owned: map[uuid.UUID]uuid.UUID{}}
}

func (m *memGames) Records(_ context.Context, userID uuid.UUID, folderKey string) ([]domain.GameRecord, error) {
	out := []domain.GameRecord{}
	for _, g := range domain.GameCatalog {
		if rec, ok := m.rows[userID.String()+"|"+folderKey+"|"+g.Name]; ok {
			out = append(out, rec)
		}
	}
	return out, nil
}

func (m *memGames) SaveResult(_ context.Context, userID uuid.UUID, folderKey string, spec domain.GameSpec, score int, of *int) (domain.GameRecord, bool, *int, error) {
	m.saves++
	m.lastKey = folderKey
	k := userID.String() + "|" + folderKey + "|" + spec.Name
	var stored *domain.GameRecord
	if rec, ok := m.rows[k]; ok {
		stored = &rec
	}
	rec, isNew, prev := spec.Merge(stored, score, of)
	m.rows[k] = rec
	return rec, isNew, prev, nil
}

func (m *memGames) FolderOwned(_ context.Context, userID, folderID uuid.UUID) (bool, error) {
	return m.owned[folderID] == userID, nil
}

func TestGameService_SaveResult_FirstBetterWorseTie(t *testing.T) {
	ctx, u := context.Background(), uuid.New()
	repo := newMemGames()
	s := NewGameService(repo)
	of := func(n int) *int { return &n }
	save := func(game string, score int, of *int) GameResult {
		t.Helper()
		res, err := s.SaveResult(ctx, u, nil, game, score, of)
		if err != nil {
			t.Fatal(err)
		}
		return res
	}

	// pairs: lower is better
	if r := save(domain.GamePairs, 40_000, nil); !r.NewRecord || r.Previous != nil || r.Record.Best != 40_000 || r.Record.Plays != 1 {
		t.Errorf("pairs first: %+v", r)
	}
	if r := save(domain.GamePairs, 35_000, nil); !r.NewRecord || r.Previous == nil || *r.Previous != 40_000 || r.Record.Best != 35_000 {
		t.Errorf("pairs better: %+v", r)
	}
	if r := save(domain.GamePairs, 50_000, nil); r.NewRecord || r.Previous != nil || r.Record.Best != 35_000 || r.Record.Plays != 3 {
		t.Errorf("pairs worse: %+v", r)
	}
	if r := save(domain.GamePairs, 35_000, nil); r.NewRecord || r.Record.Best != 35_000 || r.Record.Plays != 4 {
		t.Errorf("pairs tie: %+v", r)
	}

	// articles: higher is better, best_of goes with the best
	if r := save(domain.GameArticles, 12, of(20)); !r.NewRecord || r.Record.Best != 12 || *r.Record.BestOf != 20 {
		t.Errorf("articles first: %+v", r)
	}
	if r := save(domain.GameArticles, 17, of(19)); !r.NewRecord || *r.Previous != 12 || r.Record.Best != 17 || *r.Record.BestOf != 19 {
		t.Errorf("articles better: %+v", r)
	}
	if r := save(domain.GameArticles, 9, of(20)); r.NewRecord || r.Record.Best != 17 || *r.Record.BestOf != 19 {
		t.Errorf("articles worse: %+v", r)
	}
	if r := save(domain.GameArticles, 17, of(20)); r.NewRecord || r.Record.Best != 17 || *r.Record.BestOf != 19 || r.Record.Plays != 4 {
		t.Errorf("articles tie: %+v", r)
	}
}

func TestGameService_FolderKeys(t *testing.T) {
	ctx, u := context.Background(), uuid.New()
	repo := newMemGames()
	s := NewGameService(repo)
	mine, foreign := uuid.New(), uuid.New()
	repo.owned[mine] = u
	repo.owned[foreign] = uuid.New()

	for _, c := range []struct {
		folder *domain.FolderFilter
		key    string
	}{
		{nil, "all"},
		{&domain.FolderFilter{None: true}, "none"},
		{&domain.FolderFilter{ID: mine}, mine.String()},
	} {
		if _, err := s.SaveResult(ctx, u, c.folder, domain.GamePairs, 30_000, nil); err != nil || repo.lastKey != c.key {
			t.Errorf("%+v: key %q, err %v", c.folder, repo.lastKey, err)
		}
		if recs, err := s.Records(ctx, u, c.folder); err != nil || len(recs) != 1 {
			t.Errorf("%+v: records %+v, err %v", c.folder, recs, err)
		}
	}

	saves := repo.saves
	if _, err := s.SaveResult(ctx, u, &domain.FolderFilter{ID: foreign}, domain.GamePairs, 30_000, nil); !errors.Is(err, domain.ErrNotFound) {
		t.Errorf("foreign folder: %v", err)
	}
	if _, err := s.Records(ctx, u, &domain.FolderFilter{ID: uuid.New()}); !errors.Is(err, domain.ErrNotFound) {
		t.Errorf("unknown folder: %v", err)
	}
	if _, err := s.SaveResult(ctx, u, nil, "sprint", 10, nil); !errors.Is(err, domain.ErrValidation) {
		t.Errorf("unknown game: %v", err)
	}
	if repo.saves != saves {
		t.Errorf("nothing may be saved for a foreign folder or an invalid result: %d saves", repo.saves-saves)
	}
}
