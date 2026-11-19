package domain

import (
	"errors"
	"testing"
)

func TestValidateGameResult(t *testing.T) {
	of := func(n int) *int { return &n }
	for _, c := range []struct {
		name  string
		game  string
		score int
		of    *int
		ok    bool
	}{
		{"pairs: a time", GamePairs, 42_000, nil, true},
		{"pairs: the shortest", GamePairs, 1000, nil, true},
		{"pairs: the longest", GamePairs, 3_600_000, nil, true},
		{"pairs: too fast", GamePairs, 999, nil, false},
		{"pairs: too slow", GamePairs, 3_600_001, nil, false},
		{"pairs: with of", GamePairs, 42_000, of(12), false},
		{"articles: 17/20", GameArticles, 17, of(20), true},
		{"articles: none right", GameArticles, 0, of(20), true},
		{"articles: all right", GameArticles, 50, of(50), true},
		{"articles: no of", GameArticles, 17, nil, false},
		{"articles: of 0", GameArticles, 0, of(0), false},
		{"articles: of over 50", GameArticles, 17, of(51), false},
		{"articles: more than of", GameArticles, 21, of(20), false},
		{"articles: negative", GameArticles, -1, of(20), false},
		{"unknown game", "sprint", 10, nil, false},
		{"no game", "", 10, nil, false},
	} {
		spec, err := ValidateGameResult(c.game, c.score, c.of)
		if c.ok && (err != nil || spec.Name != c.game) {
			t.Errorf("%s: %v %+v", c.name, err, spec)
		}
		if !c.ok && !errors.Is(err, ErrValidation) {
			t.Errorf("%s: want ErrValidation, got %v", c.name, err)
		}
	}
}

func TestGameCatalog(t *testing.T) {
	pairs, _ := GameByName(GamePairs)
	articles, _ := GameByName(GameArticles)
	if !pairs.LowerIsBetter || pairs.NeedsOf || articles.LowerIsBetter || !articles.NeedsOf {
		t.Errorf("pairs %+v, articles %+v", pairs, articles)
	}
}

func TestGameMerge(t *testing.T) {
	of := func(n int) *int { return &n }
	pairs, _ := GameByName(GamePairs)
	articles, _ := GameByName(GameArticles)
	stored := func(best int, bestOf *int) *GameRecord { return &GameRecord{Best: best, BestOf: bestOf, Plays: 3} }

	for _, c := range []struct {
		name     string
		spec     GameSpec
		stored   *GameRecord
		score    int
		of       *int
		best     int
		bestOf   *int
		newBest  bool
		previous *int
	}{
		{"pairs: first", pairs, nil, 40_000, nil, 40_000, nil, true, nil},
		{"pairs: faster is better", pairs, stored(40_000, nil), 35_000, nil, 35_000, nil, true, of(40_000)},
		{"pairs: slower is worse", pairs, stored(40_000, nil), 45_000, nil, 40_000, nil, false, nil},
		{"pairs: a tie is no record", pairs, stored(40_000, nil), 40_000, nil, 40_000, nil, false, nil},
		{"articles: first", articles, nil, 12, of(20), 12, of(20), true, nil},
		{"articles: more is better", articles, stored(12, of(20)), 17, of(18), 17, of(18), true, of(12)},
		{"articles: fewer is worse", articles, stored(12, of(20)), 9, of(20), 12, of(20), false, nil},
		{"articles: a tie keeps the old of", articles, stored(12, of(20)), 12, of(15), 12, of(20), false, nil},
	} {
		rec, isNew, prev := c.spec.Merge(c.stored, c.score, c.of)
		wantPlays := 1
		if c.stored != nil {
			wantPlays = c.stored.Plays + 1
		}
		if rec.Game != c.spec.Name || rec.Best != c.best || !sameInt(rec.BestOf, c.bestOf) || rec.Plays != wantPlays ||
			isNew != c.newBest || !sameInt(prev, c.previous) {
			t.Errorf("%s: %+v new=%v prev=%v", c.name, rec, isNew, prev)
		}
	}
}

func sameInt(a, b *int) bool { return (a == nil && b == nil) || (a != nil && b != nil && *a == *b) }
