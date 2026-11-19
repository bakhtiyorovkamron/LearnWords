package postgres

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"learnwords/internal/domain"
)

// GameRepository keeps the folder games' best results (game_records).
type GameRepository struct{ pool *pgxpool.Pool }

func NewGameRepository(pool *pgxpool.Pool) *GameRepository { return &GameRepository{pool: pool} }

// Records returns the user's records for one folder key ('all', 'none' or a folder id), by game.
func (r *GameRepository) Records(ctx context.Context, userID uuid.UUID, folderKey string) ([]domain.GameRecord, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT game, best, best_of, plays FROM game_records WHERE user_id = $1 AND folder_key = $2 ORDER BY game`,
		userID, folderKey)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []domain.GameRecord{}
	for rows.Next() {
		var rec domain.GameRecord
		if err := rows.Scan(&rec.Game, &rec.Best, &rec.BestOf, &rec.Plays); err != nil {
			return nil, err
		}
		out = append(out, rec)
	}
	return out, rows.Err()
}

// SaveResult counts a play and keeps the better of the stored best and score (spec.Merge: which
// way is better, a tie keeps the old one). The row is locked FOR UPDATE, so parallel results
// neither lose a play nor keep the worse best. newRecord: the score is the first or a better one;
// previous is the best it beat (nil for the first).
func (r *GameRepository) SaveResult(ctx context.Context, userID uuid.UUID, folderKey string, spec domain.GameSpec, score int, of *int) (rec domain.GameRecord, newRecord bool, previous *int, err error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return rec, false, nil, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck // a no-op after Commit

	stored, err := lockGameRecord(ctx, tx, userID, folderKey, spec.Name)
	if err != nil {
		return rec, false, nil, err
	}
	if stored == nil {
		rec, newRecord, previous = spec.Merge(nil, score, of)
		var inserted bool
		err := tx.QueryRow(ctx, `
			INSERT INTO game_records (user_id, folder_key, game, best, best_of) VALUES ($1, $2, $3, $4, $5)
			ON CONFLICT (user_id, folder_key, game) DO NOTHING
			RETURNING true`, userID, folderKey, spec.Name, rec.Best, rec.BestOf).Scan(&inserted)
		if err == nil {
			if err := tx.Commit(ctx); err != nil {
				return domain.GameRecord{}, false, nil, err
			}
			return rec, newRecord, previous, nil
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return domain.GameRecord{}, false, nil, err
		}
		// A parallel first result inserted the row meanwhile: this one is a play of it.
		if stored, err = lockGameRecord(ctx, tx, userID, folderKey, spec.Name); err != nil {
			return domain.GameRecord{}, false, nil, err
		}
		if stored == nil {
			return domain.GameRecord{}, false, nil, errors.New("game record vanished") // deleted with its user
		}
	}

	rec, newRecord, previous = spec.Merge(stored, score, of)
	if _, err := tx.Exec(ctx, `
		UPDATE game_records SET best = $4, best_of = $5, plays = $6, updated_at = now()
		WHERE user_id = $1 AND folder_key = $2 AND game = $3`,
		userID, folderKey, spec.Name, rec.Best, rec.BestOf, rec.Plays); err != nil {
		return domain.GameRecord{}, false, nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return domain.GameRecord{}, false, nil, err
	}
	return rec, newRecord, previous, nil
}

// lockGameRecord reads one record and locks it for the transaction; nil = none yet.
func lockGameRecord(ctx context.Context, tx pgx.Tx, userID uuid.UUID, folderKey, game string) (*domain.GameRecord, error) {
	rec := domain.GameRecord{Game: game}
	err := tx.QueryRow(ctx,
		`SELECT best, best_of, plays FROM game_records WHERE user_id = $1 AND folder_key = $2 AND game = $3 FOR UPDATE`,
		userID, folderKey, game).Scan(&rec.Best, &rec.BestOf, &rec.Plays)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &rec, nil
}

// FolderOwned reports whether the folder exists and is the user's.
func (r *GameRepository) FolderOwned(ctx context.Context, userID, folderID uuid.UUID) (bool, error) {
	var ok bool
	err := r.pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM folders WHERE id = $1 AND user_id = $2)`, folderID, userID).Scan(&ok)
	return ok, err
}
