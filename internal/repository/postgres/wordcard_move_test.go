package postgres

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"learnwords/internal/domain"
)

// Integration tests need a real Postgres: TEST_DATABASE_URL=postgres://… go test ./internal/repository/postgres
// (the schema is migrated by the test). Without it they are skipped.
func testPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL is not set")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	if err := Migrate(ctx, pool); err != nil {
		t.Fatal(err)
	}
	return pool
}

type moveFixture struct {
	pool *pgxpool.Pool
	user uuid.UUID
}

func newMoveFixture(t *testing.T) moveFixture {
	t.Helper()
	pool := testPool(t)
	u := uuid.New()
	if _, err := pool.Exec(context.Background(),
		`INSERT INTO users (id, email, password_hash) VALUES ($1, $2, 'x')`, u, u.String()+"@test"); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { pool.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, u) }) //nolint:errcheck
	return moveFixture{pool: pool, user: u}
}

func (f moveFixture) exec(t *testing.T, sql string, args ...any) {
	t.Helper()
	if _, err := f.pool.Exec(context.Background(), sql, args...); err != nil {
		t.Fatal(err)
	}
}

func (f moveFixture) folder(t *testing.T, owner uuid.UUID) uuid.UUID {
	id := uuid.New()
	f.exec(t, `INSERT INTO folders (id, user_id, name) VALUES ($1, $2, $3)`, id, owner, id.String())
	return id
}

// word creates a card of owner in folder (nil = none) with a progress row (box 4, due on due).
func (f moveFixture) word(t *testing.T, owner uuid.UUID, folder *uuid.UUID, due time.Time) uuid.UUID {
	ctxID, id := uuid.New(), uuid.New()
	f.exec(t, `INSERT INTO contexts (id, user_id, source_text) VALUES ($1, $2, 'x')`, ctxID, owner)
	f.exec(t, `INSERT INTO word_cards (id, context_id, user_id, word, folder_id) VALUES ($1, $2, $3, 'w', $4)`,
		id, ctxID, owner, folder)
	f.exec(t, `INSERT INTO word_progress (word_id, user_id, box_level, next_review_at) VALUES ($1, $2, 4, $3)`,
		id, owner, due)
	return id
}

func (f moveFixture) folderOf(t *testing.T, word uuid.UUID) *uuid.UUID {
	var fid *uuid.UUID
	if err := f.pool.QueryRow(context.Background(), `SELECT folder_id FROM word_cards WHERE id = $1`, word).Scan(&fid); err != nil {
		t.Fatal(err)
	}
	return fid
}

func eq(a, b *uuid.UUID) bool { return (a == nil && b == nil) || (a != nil && b != nil && *a == *b) }

func TestMoveWords_OneManyAndBackToNoFolder(t *testing.T) {
	f := newMoveFixture(t)
	repo, ctx := NewWordCardRepository(f.pool), context.Background()
	a, b := f.folder(t, f.user), f.folder(t, f.user)
	w1, w2, w3 := f.word(t, f.user, nil, time.Now()), f.word(t, f.user, &a, time.Now()), f.word(t, f.user, nil, time.Now())

	prev, err := repo.MoveWords(ctx, f.user, []uuid.UUID{w1}, &b)
	if err != nil || len(prev) != 1 || prev[0].FolderID != nil || !eq(f.folderOf(t, w1), &b) {
		t.Fatalf("one: %+v %v", prev, err)
	}
	prev, err = repo.MoveWords(ctx, f.user, []uuid.UUID{w1, w2, w3}, &b)
	if err != nil || len(prev) != 3 {
		t.Fatalf("many: %+v %v", prev, err)
	}
	if !eq(prev[0].FolderID, &b) || !eq(prev[1].FolderID, &a) || prev[2].FolderID != nil {
		t.Errorf("previous folders: %+v", prev)
	}
	for _, w := range []uuid.UUID{w1, w2, w3} {
		if !eq(f.folderOf(t, w), &b) {
			t.Errorf("%s not in b", w)
		}
	}
	if _, err := repo.MoveWords(ctx, f.user, []uuid.UUID{w1, w2}, nil); err != nil {
		t.Fatal(err)
	}
	if f.folderOf(t, w1) != nil || f.folderOf(t, w2) != nil || !eq(f.folderOf(t, w3), &b) {
		t.Error("move to 'no folder' failed")
	}
}

func TestMoveWords_ForeignWordOrFolderIsNotFoundAndNothingMoves(t *testing.T) {
	f := newMoveFixture(t)
	other := newMoveFixture(t)
	repo, ctx := NewWordCardRepository(f.pool), context.Background()
	mine, theirs := f.folder(t, f.user), other.folder(t, other.user)
	w1, w2 := f.word(t, f.user, nil, time.Now()), f.word(t, f.user, nil, time.Now())
	foreign := other.word(t, other.user, nil, time.Now())

	if _, err := repo.MoveWords(ctx, f.user, []uuid.UUID{w1, foreign, w2}, &mine); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("foreign word: %v", err)
	}
	if _, err := repo.MoveWords(ctx, f.user, []uuid.UUID{w1, w2}, &theirs); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("foreign folder: %v", err)
	}
	if _, err := repo.MoveWords(ctx, f.user, []uuid.UUID{w1, uuid.New()}, &mine); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("missing word: %v", err)
	}
	if f.folderOf(t, w1) != nil || f.folderOf(t, w2) != nil || other.folderOf(t, foreign) != nil {
		t.Error("a rejected request moved something")
	}
}

func TestMoveWords_ProgressUntouched(t *testing.T) {
	f := newMoveFixture(t)
	repo, ctx := NewWordCardRepository(f.pool), context.Background()
	folder := f.folder(t, f.user)
	due := time.Date(2030, 5, 17, 0, 0, 0, 0, time.UTC)
	w := f.word(t, f.user, nil, due)

	read := func() (box int, next time.Time, learned bool) {
		if err := f.pool.QueryRow(ctx,
			`SELECT box_level, next_review_at, is_learned FROM word_progress WHERE word_id = $1`, w).Scan(&box, &next, &learned); err != nil {
			t.Fatal(err)
		}
		return
	}
	box0, next0, learned0 := read()
	if _, err := repo.MoveWords(ctx, f.user, []uuid.UUID{w}, &folder); err != nil {
		t.Fatal(err)
	}
	if box, next, learned := read(); box != box0 || !next.Equal(next0) || learned != learned0 || box != 4 || !next.Equal(due) {
		t.Errorf("progress changed: box %d next %v learned %v", box, next, learned)
	}
}

// Undo = move each group of words back to its own previous folder (the client groups by folder).
func TestMoveWords_UndoRestoresEachPreviousFolder(t *testing.T) {
	f := newMoveFixture(t)
	repo, ctx := NewWordCardRepository(f.pool), context.Background()
	a, b, target := f.folder(t, f.user), f.folder(t, f.user), f.folder(t, f.user)
	ws := []uuid.UUID{f.word(t, f.user, &a, time.Now()), f.word(t, f.user, &b, time.Now()), f.word(t, f.user, nil, time.Now()), f.word(t, f.user, &a, time.Now())}
	want := []*uuid.UUID{&a, &b, nil, &a}

	prev, err := repo.MoveWords(ctx, f.user, ws, &target)
	if err != nil {
		t.Fatal(err)
	}
	groups := map[uuid.UUID][]uuid.UUID{}
	var none []uuid.UUID
	for _, p := range prev {
		if p.FolderID == nil {
			none = append(none, p.WordID)
		} else {
			groups[*p.FolderID] = append(groups[*p.FolderID], p.WordID)
		}
	}
	for fid, ids := range groups {
		fid := fid
		if _, err := repo.MoveWords(ctx, f.user, ids, &fid); err != nil {
			t.Fatal(err)
		}
	}
	if len(none) > 0 {
		if _, err := repo.MoveWords(ctx, f.user, none, nil); err != nil {
			t.Fatal(err)
		}
	}
	for i, w := range ws {
		if !eq(f.folderOf(t, w), want[i]) {
			t.Errorf("word %d not restored", i)
		}
	}
}

func TestFolderCountsFollowMoves(t *testing.T) {
	f := newMoveFixture(t)
	repo, folders, ctx := NewWordCardRepository(f.pool), NewFolderRepository(f.pool), context.Background()
	a, b := f.folder(t, f.user), f.folder(t, f.user)
	w1, w2 := f.word(t, f.user, &a, time.Now().Add(-48*time.Hour)), f.word(t, f.user, &a, time.Now().Add(-48*time.Hour))

	if _, err := repo.MoveWords(ctx, f.user, []uuid.UUID{w1, w2}, &b); err != nil {
		t.Fatal(err)
	}
	list, err := folders.List(ctx, f.user)
	if err != nil {
		t.Fatal(err)
	}
	for _, fl := range list.Folders {
		switch fl.ID {
		case a:
			if fl.Total != 0 || fl.DueToday != 0 {
				t.Errorf("a: %+v", fl.FolderStats)
			}
		case b:
			if fl.Total != 2 || fl.DueToday != 2 {
				t.Errorf("b: %+v", fl.FolderStats)
			}
		}
	}
}
