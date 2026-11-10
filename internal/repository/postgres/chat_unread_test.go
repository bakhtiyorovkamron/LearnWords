package postgres

import (
	"context"
	"errors"
	"os"
	"strings"
	"testing"

	"github.com/google/uuid"

	"learnwords/internal/domain"
)

func TestChatUnread_UserCountsAdminAndSystemOnly_OwnPostMarksRead_NeverBackwards(t *testing.T) {
	f := newMoveFixture(t)
	admin, other := addUser(t, f, "admin", false), addUser(t, f, "user", false)
	r, units, ctx := NewSupportRepository(f.pool), NewChatUnreadRepository(f.pool), context.Background()
	mine, _ := r.EnsureThread(ctx, f.user)
	theirs, _ := r.EnsureThread(ctx, other)
	add := func(th int64, role string, who uuid.UUID, hidden bool) domain.ChatMessage {
		t.Helper()
		m := domain.ChatMessage{AuthorRole: role, AuthorUserID: &who, Body: strp("x"), Hidden: hidden}
		saved, err := r.AddMessage(ctx, th, m, nil)
		if err != nil {
			t.Fatal(err)
		}
		return saved
	}
	support := func() int {
		t.Helper()
		u, err := units.ForUser(ctx, f.user)
		if err != nil {
			t.Fatal(err)
		}
		return u.Support
	}

	add(mine.ID, "user", f.user, false)
	if n := support(); n != 0 {
		t.Errorf("the user's own message is not unread: %d", n)
	}
	a1 := add(mine.ID, "admin", admin, false)
	a2 := add(mine.ID, "admin", admin, false)
	add(mine.ID, "admin", admin, true) // hidden from the user: not counted
	add(theirs.ID, "admin", admin, false)
	if n := support(); n != 2 {
		t.Fatalf("unread %d, want 2 (the admin's visible messages only)", n)
	}

	if err := r.MarkUserRead(ctx, f.user, mine.ID, a1.ID); err != nil {
		t.Fatal(err)
	}
	if n := support(); n != 1 {
		t.Errorf("after reading the first: %d", n)
	}
	if err := r.MarkUserRead(ctx, f.user, mine.ID, a1.ID-1); err != nil { // never backwards
		t.Fatal(err)
	}
	if th, _ := r.Thread(ctx, mine.ID); th.ReadMarkers.User != a1.ID {
		t.Errorf("marker moved back to %d", th.ReadMarkers.User)
	}
	if err := r.MarkUserRead(ctx, f.user, mine.ID, 1<<40); err != nil { // clamped to the newest message
		t.Fatal(err)
	}
	if n := support(); n != 0 {
		t.Errorf("after reading everything: %d", n)
	}
	later := add(mine.ID, "admin", admin, false)
	if n := support(); n != 1 || later.ID <= a2.ID {
		t.Errorf("a later message must be unread again: %d", n)
	}

	// A user marks only their own thread.
	if err := r.MarkUserRead(ctx, f.user, theirs.ID, 1<<40); !errors.Is(err, domain.ErrNotFound) {
		t.Errorf("another user's thread: %v", err)
	}
	if n, _ := units.ForUser(ctx, other); n.Support != 1 {
		t.Errorf("the other user's unread changed: %d", n.Support)
	}
}

func TestChatUnread_PurchasesPerRequestAndSystemLines(t *testing.T) {
	f := newMoveFixture(t)
	admin, other := addUser(t, f, "admin", false), addUser(t, f, "user", false)
	purchases, units, ctx := NewPurchaseRepository(f.pool), NewChatUnreadRepository(f.pool), context.Background()
	pack, _ := domain.PackByID("photo_35")
	p1, _ := purchases.Create(ctx, f.user, pack, 3)
	p2, _ := purchases.Create(ctx, f.user, pack, 3)
	quiet, _ := purchases.Create(ctx, f.user, pack, 3) // no thread at all
	po, _ := purchases.Create(ctx, other, pack, 3)
	say := func(id uuid.UUID, role string, who uuid.UUID) {
		t.Helper()
		if _, err := purchases.AddMessage(ctx, id, domain.ChatMessage{AuthorRole: role, AuthorUserID: &who, Body: strp("x")}, nil); err != nil {
			t.Fatal(err)
		}
	}
	say(p1.ID, "user", f.user)
	say(p1.ID, "admin", admin)
	say(p2.ID, "admin", admin)
	say(p2.ID, "admin", admin)
	say(po.ID, "admin", admin)
	if _, err := purchases.Approve(ctx, p1.ID, admin); err != nil { // a system line is unread too
		t.Fatal(err)
	}

	got, err := units.ForUser(ctx, f.user)
	if err != nil {
		t.Fatal(err)
	}
	by := map[uuid.UUID]domain.PurchaseChatUnread{}
	for _, p := range got.Purchases {
		by[p.ID] = p
	}
	if got.Support != 0 || len(got.Purchases) != 2 || by[p1.ID].Unread != 2 || by[p2.ID].Unread != 2 ||
		by[p1.ID].Code != p1.Code {
		t.Fatalf("%+v", got)
	}
	if _, ok := by[quiet.ID]; ok {
		t.Error("a request without a thread is listed")
	}

	if err := purchases.MarkUserRead(ctx, p1.ID, f.user, 1<<40); err != nil {
		t.Fatal(err)
	}
	if err := purchases.MarkUserRead(ctx, po.ID, f.user, 1<<40); err != nil { // not theirs: nothing happens
		t.Fatal(err)
	}
	if m, _ := purchases.ChatMarkers(ctx, po.ID); m.User != 0 {
		t.Errorf("another user's request marked read: %+v", m)
	}
	got, _ = units.ForUser(ctx, f.user)
	if len(got.Purchases) != 1 || got.Purchases[0].ID != p2.ID {
		t.Errorf("after reading p1: %+v", got)
	}
	if m, _ := purchases.ChatMarkers(ctx, quiet.ID); m != (domain.ChatReadMarkers{}) {
		t.Errorf("no thread: %+v", m)
	}
}

func TestChatUnread_AdminTotals(t *testing.T) {
	f := newMoveFixture(t)
	admin := addUser(t, f, "admin", false)
	support, purchases, units, ctx := NewSupportRepository(f.pool), NewPurchaseRepository(f.pool), NewChatUnreadRepository(f.pool), context.Background()
	before, err := units.ForAdmins(ctx)
	if err != nil {
		t.Fatal(err)
	}
	th, _ := support.EnsureThread(ctx, f.user)
	pack, _ := domain.PackByID("photo_35")
	p, _ := purchases.Create(ctx, f.user, pack, 3)
	for i := 0; i < 2; i++ {
		if _, err := support.AddMessage(ctx, th.ID, domain.ChatMessage{AuthorRole: "user", AuthorUserID: &f.user, Body: strp("x")}, nil); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := purchases.AddMessage(ctx, p.ID, domain.ChatMessage{AuthorRole: "user", AuthorUserID: &f.user, Body: strp("x")}, nil); err != nil {
		t.Fatal(err)
	}
	if _, err := purchases.AddMessage(ctx, p.ID, domain.ChatMessage{AuthorRole: "admin", AuthorUserID: &admin, Body: strp("x")}, nil); err != nil {
		t.Fatal(err) // an admin's own reply is never unread, and marks the thread read
	}
	got, _ := units.ForAdmins(ctx)
	if got.Support != before.Support+2 || got.Purchases != before.Purchases {
		t.Errorf("before %+v after %+v: want support +2, purchases +0 (the admin replied)", before, got)
	}
	if err := support.MarkRead(ctx, th.ID, 0); err != nil {
		t.Fatal(err)
	}
	if got, _ = units.ForAdmins(ctx); got.Support != before.Support {
		t.Errorf("after reading: %+v", got)
	}
}

// The migration's backfill leaves old history read: run its UPDATE on threads that have none.
func TestChatUnread_BackfillLeavesNothingUnread(t *testing.T) {
	f := newMoveFixture(t)
	admin := addUser(t, f, "admin", false)
	r, units, ctx := NewSupportRepository(f.pool), NewChatUnreadRepository(f.pool), context.Background()
	th, _ := r.EnsureThread(ctx, f.user)
	for _, role := range []string{"admin", "admin", "user", "admin"} {
		who := admin
		if role == "user" {
			who = f.user
		}
		if _, err := r.AddMessage(ctx, th.ID, domain.ChatMessage{AuthorRole: role, AuthorUserID: &who, Body: strp("x")}, nil); err != nil {
			t.Fatal(err)
		}
	}
	f.exec(t, `UPDATE chat_threads SET user_read_message_id = NULL WHERE id = $1`, th.ID) // as before the migration
	if u, _ := units.ForUser(ctx, f.user); u.Support != 3 {
		t.Fatalf("setup: %d unread", u.Support)
	}

	sql, err := os.ReadFile("../../../migrations/000052_chat_user_read.up.sql")
	if err != nil {
		t.Fatal(err)
	}
	i := strings.Index(string(sql), "UPDATE chat_threads")
	if i < 0 {
		t.Fatal("no backfill in the migration")
	}
	f.exec(t, string(sql)[i:])
	if u, _ := units.ForUser(ctx, f.user); u.Support != 0 {
		t.Errorf("after the backfill: %d unread", u.Support)
	}
}
