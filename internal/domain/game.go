package domain

import "fmt"

// Folder games (behind FeatureFolderGames): small games over the words of one folder. They never
// touch the Leitner schedule; only each game's best result per folder is kept (game_records).
const (
	GamePairs    = "pairs"    // match words with their translations; the score is the time in ms, penalties included
	GameArticles = "articles" // der · die · das: the score is the nouns right on the first try, out of `of`
)

// GameSpec describes a game of the catalog. LowerIsBetter: a time (pairs), otherwise points.
// NeedsOf: the score is "out of" a total (17/20), which comes with it.
type GameSpec struct {
	Name          string
	LowerIsBetter bool
	NeedsOf       bool
}

// GameCatalog lists the games a result may be saved for.
var GameCatalog = []GameSpec{
	{Name: GamePairs, LowerIsBetter: true},
	{Name: GameArticles, NeedsOf: true},
}

// GameByName looks a game up in the catalog.
func GameByName(name string) (GameSpec, bool) {
	for _, g := range GameCatalog {
		if g.Name == name {
			return g, true
		}
	}
	return GameSpec{}, false
}

// GameRecord is a user's best result in one game for one folder. BestOf is the "out of" of the
// best (17/20), nil for pairs; Plays counts every saved result, record or not.
type GameRecord struct {
	Game   string `json:"game"`
	Best   int    `json:"best"`
	BestOf *int   `json:"best_of"`
	Plays  int    `json:"plays"`
}

// Limits of a result.
const (
	PairsMinMs   = 1000      // a full board takes longer than a second
	PairsMaxMs   = 3_600_000 // an hour
	ArticlesMaxN = 50
)

// ValidateGameResult checks a result for the game and returns its spec. Pairs: a time of
// PairsMinMs..PairsMaxMs and no `of`. Articles: of 1..ArticlesMaxN and a score 0..of.
func ValidateGameResult(game string, score int, of *int) (GameSpec, error) {
	spec, ok := GameByName(game)
	if !ok {
		return GameSpec{}, fmt.Errorf("%w: unknown game", ErrValidation)
	}
	switch spec.Name {
	case GamePairs:
		if of != nil {
			return GameSpec{}, fmt.Errorf("%w: pairs takes no of", ErrValidation)
		}
		if score < PairsMinMs || score > PairsMaxMs {
			return GameSpec{}, fmt.Errorf("%w: pairs score must be %d..%d ms", ErrValidation, PairsMinMs, PairsMaxMs)
		}
	case GameArticles:
		if of == nil || *of < 1 || *of > ArticlesMaxN {
			return GameSpec{}, fmt.Errorf("%w: articles needs of 1..%d", ErrValidation, ArticlesMaxN)
		}
		if score < 0 || score > *of {
			return GameSpec{}, fmt.Errorf("%w: articles score must be 0..of", ErrValidation)
		}
	}
	return spec, nil
}

// Beats reports whether score is a better result than best for this game (a tie is not).
func (g GameSpec) Beats(score, best int) bool {
	if g.LowerIsBetter {
		return score < best
	}
	return score > best
}

// Merge folds one finished game into the stored record (nil = never played here) and returns the
// record to store: one more play, and score with its of as the best when it beats the old best (a
// tie keeps the old one). newRecord: the first or a better result; previous: the best it beat.
func (g GameSpec) Merge(stored *GameRecord, score int, of *int) (rec GameRecord, newRecord bool, previous *int) {
	if stored == nil {
		return GameRecord{Game: g.Name, Best: score, BestOf: of, Plays: 1}, true, nil
	}
	rec = *stored
	rec.Game = g.Name
	rec.Plays++
	if g.Beats(score, stored.Best) {
		old := stored.Best
		rec.Best, rec.BestOf = score, of
		return rec, true, &old
	}
	return rec, false, nil
}
