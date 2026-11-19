package service

import (
	"context"

	"github.com/google/uuid"

	"learnwords/internal/domain"
)

// GameRepository stores the folder games' best results (postgres.GameRepository).
type GameRepository interface {
	Records(ctx context.Context, userID uuid.UUID, folderKey string) ([]domain.GameRecord, error)
	SaveResult(ctx context.Context, userID uuid.UUID, folderKey string, spec domain.GameSpec, score int, of *int) (domain.GameRecord, bool, *int, error)
	FolderOwned(ctx context.Context, userID, folderID uuid.UUID) (bool, error)
}

// GameResult is what saving a result says: the record as it is now, whether this result is it
// (the first or a better one), and the best it beat.
type GameResult struct {
	Record    domain.GameRecord `json:"record"`
	NewRecord bool              `json:"new_record"`
	Previous  *int              `json:"previous"`
}

// GameService keeps the best result of each folder game per folder. Games never touch the Leitner
// schedule: nothing here reads or writes word progress.
type GameService struct{ repo GameRepository }

func NewGameService(repo GameRepository) *GameService { return &GameService{repo: repo} }

// Records returns the user's records for the folder (nil = all words). A folder id that is not
// the user's → domain.ErrNotFound.
func (s *GameService) Records(ctx context.Context, userID uuid.UUID, folder *domain.FolderFilter) ([]domain.GameRecord, error) {
	key, err := s.folderKey(ctx, userID, folder)
	if err != nil {
		return nil, err
	}
	return s.repo.Records(ctx, userID, key)
}

// SaveResult validates and saves one finished game. Unknown game or a score out of its range →
// domain.ErrValidation; a folder id that is not the user's → domain.ErrNotFound.
func (s *GameService) SaveResult(ctx context.Context, userID uuid.UUID, folder *domain.FolderFilter, game string, score int, of *int) (GameResult, error) {
	spec, err := domain.ValidateGameResult(game, score, of)
	if err != nil {
		return GameResult{}, err
	}
	key, err := s.folderKey(ctx, userID, folder)
	if err != nil {
		return GameResult{}, err
	}
	rec, isNew, prev, err := s.repo.SaveResult(ctx, userID, key, spec, score, of)
	if err != nil {
		return GameResult{}, err
	}
	return GameResult{Record: rec, NewRecord: isNew, Previous: prev}, nil
}

// folderKey: nil → "all", None → "none", an id → its string, once it is known to be the user's.
func (s *GameService) folderKey(ctx context.Context, userID uuid.UUID, folder *domain.FolderFilter) (string, error) {
	switch {
	case folder == nil:
		return "all", nil
	case folder.None:
		return "none", nil
	}
	ok, err := s.repo.FolderOwned(ctx, userID, folder.ID)
	if err != nil {
		return "", err
	}
	if !ok {
		return "", domain.ErrNotFound
	}
	return folder.ID.String(), nil
}
