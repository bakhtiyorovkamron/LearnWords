package postgres

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestPush_UpsertReassign_DeleteOnlyOwn_Stats(t *testing.T) {
	f := newMoveFixture(t)
	repo, ctx := NewPushRepository(f.pool), context.Background()
	other := uuid.New()
	f.exec(t, `INSERT INTO users (id, email, password_hash) VALUES ($1, $2, 'x')`, other, other.String()+"@test")
	t.Cleanup(func() { f.pool.Exec(ctx, `DELETE FROM users WHERE id = $1`, other) }) //nolint:errcheck

	ep1, ep2 := "https://push.example.com/"+uuid.NewString(), "https://push.example.com/"+uuid.NewString()
	t.Cleanup(func() { f.pool.Exec(ctx, `DELETE FROM push_subscriptions WHERE endpoint IN ($1, $2)`, ep1, ep2) }) //nolint:errcheck

	if err := repo.Upsert(ctx, f.user, ep1, "key1", "auth1", "UA1"); err != nil {
		t.Fatal(err)
	}
	if err := repo.Upsert(ctx, f.user, ep2, "key2", "auth2", ""); err != nil {
		t.Fatal(err)
	}
	// the same endpoint again: one row, keys refreshed
	if err := repo.Upsert(ctx, f.user, ep1, "key1b", "auth1b", "UA1b"); err != nil {
		t.Fatal(err)
	}
	mine, _ := repo.ByUser(ctx, f.user)
	if len(mine) != 2 {
		t.Fatalf("rows %d, want 2", len(mine))
	}
	// the endpoint moves to another user
	if err := repo.Upsert(ctx, other, ep1, "key1c", "auth1c", "UA"); err != nil {
		t.Fatal(err)
	}
	if mine, _ = repo.ByUser(ctx, f.user); len(mine) != 1 || mine[0].Endpoint != ep2 {
		t.Errorf("the first user keeps only ep2: %+v", mine)
	}
	theirs, _ := repo.ByUser(ctx, other)
	if len(theirs) != 1 || theirs[0].Endpoint != ep1 || theirs[0].P256dh != "key1c" {
		t.Errorf("reassigned row: %+v", theirs)
	}

	// deleting someone else's endpoint changes nothing
	if err := repo.DeleteOwn(ctx, f.user, ep1); err != nil {
		t.Fatal(err)
	}
	if theirs, _ = repo.ByUser(ctx, other); len(theirs) != 1 {
		t.Error("DeleteOwn removed another user's device")
	}
	if err := repo.DeleteOwn(ctx, other, ep1); err != nil {
		t.Fatal(err)
	}
	if theirs, _ = repo.ByUser(ctx, other); len(theirs) != 0 {
		t.Error("own device not deleted")
	}

	// the numbers (shared database: compare with the rows this test owns)
	devices, users, err := repo.Stats(ctx)
	if err != nil || devices < 1 || users < 1 {
		t.Errorf("stats: %d %d %v", devices, users, err)
	}
}

func TestPush_MarkSuccess_DeleteEndpoint_AndTheUsersList(t *testing.T) {
	f := newMoveFixture(t)
	repo, ctx := NewPushRepository(f.pool), context.Background()
	ep := "https://push.example.com/" + uuid.NewString()
	t.Cleanup(func() { f.pool.Exec(ctx, `DELETE FROM push_subscriptions WHERE endpoint = $1`, ep) }) //nolint:errcheck
	if err := repo.Upsert(ctx, f.user, ep, "k", "a", "UA"); err != nil {
		t.Fatal(err)
	}

	var stamp *time.Time
	read := func() {
		if err := f.pool.QueryRow(ctx, `SELECT last_success_at FROM push_subscriptions WHERE endpoint = $1`, ep).Scan(&stamp); err != nil {
			t.Fatal(err)
		}
	}
	read()
	if stamp != nil {
		t.Fatal("a new device has no success yet")
	}
	if err := repo.MarkSuccess(ctx, ep); err != nil {
		t.Fatal(err)
	}
	if read(); stamp == nil || time.Since(*stamp) > time.Minute {
		t.Errorf("last_success_at: %v", stamp)
	}

	users, err := NewAdminRepository(f.pool).ListUsers(ctx)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, u := range users {
		if u.ID == f.user {
			found = true
			if u.PushDevices != 1 {
				t.Errorf("push_devices %d, want 1", u.PushDevices)
			}
		} else if u.PushDevices < 0 {
			t.Errorf("negative count")
		}
	}
	if !found {
		t.Error("user missing from the list")
	}

	if err := repo.DeleteEndpoint(ctx, ep); err != nil {
		t.Fatal(err)
	}
	if mine, _ := repo.ByUser(ctx, f.user); len(mine) != 0 {
		t.Error("DeleteEndpoint left the row")
	}
	if err := repo.DeleteEndpoint(ctx, ep); err != nil {
		t.Errorf("deleting a missing endpoint must not fail: %v", err)
	}
}
