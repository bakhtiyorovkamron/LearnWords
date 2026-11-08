package postgres

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"

	"learnwords/internal/domain"
)

func telegramOf(t *testing.T, f moveFixture, user uuid.UUID) (*int64, *string) {
	t.Helper()
	var chat *int64
	var name *string
	if err := f.pool.QueryRow(context.Background(), `SELECT telegram_chat_id, telegram_username FROM users WHERE id = $1`, user).Scan(&chat, &name); err != nil {
		t.Fatal(err)
	}
	return chat, name
}

func codesOf(t *testing.T, f moveFixture, user uuid.UUID) []string {
	t.Helper()
	rows, err := f.pool.Query(context.Background(), `SELECT code FROM telegram_link_codes WHERE user_id = $1`, user)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var c string
		_ = rows.Scan(&c)
		out = append(out, c)
	}
	return out
}

// uniqueCode: codes are a global primary key, so every test run uses its own.
func uniqueCode() string { return "YL-" + uuid.NewString()[:6] }

func TestTelegramRepo_OneActiveCodePerUser(t *testing.T) {
	f := newMoveFixture(t)
	r, ctx := NewTelegramRepository(f.pool), context.Background()
	exp := time.Now().Add(10 * time.Minute)
	first, second := uniqueCode(), uniqueCode()
	if err := r.ReplaceLinkCode(ctx, f.user, first, exp); err != nil {
		t.Fatal(err)
	}
	if err := r.ReplaceLinkCode(ctx, f.user, second, exp); err != nil {
		t.Fatal(err)
	}
	if got := codesOf(t, f, f.user); len(got) != 1 || got[0] != second {
		t.Errorf("codes = %v, want only %s", got, second)
	}
	if ok, _ := r.BindTelegram(ctx, first, 1001, nil, time.Now()); ok {
		t.Error("the replaced code still binds")
	}
}

func TestTelegramRepo_ExpiredCodeDoesNotBind(t *testing.T) {
	f := newMoveFixture(t)
	r, ctx := NewTelegramRepository(f.pool), context.Background()
	now := time.Now()
	code := uniqueCode()
	if err := r.ReplaceLinkCode(ctx, f.user, code, now.Add(10*time.Minute)); err != nil {
		t.Fatal(err)
	}
	if ok, err := r.BindTelegram(ctx, code, 1002, nil, now.Add(10*time.Minute)); err != nil || ok {
		t.Errorf("at expires_at: ok=%v err=%v, want not bound", ok, err)
	}
	if chat, _ := telegramOf(t, f, f.user); chat != nil {
		t.Error("expired code bound the account")
	}
	if ok, _ := r.BindTelegram(ctx, code, 1002, nil, now.Add(9*time.Minute)); !ok {
		t.Error("a code inside its 10 minutes must bind")
	}
}

func TestTelegramRepo_BindIsIdempotent(t *testing.T) {
	f := newMoveFixture(t)
	r, ctx := NewTelegramRepository(f.pool), context.Background()
	code, name := uniqueCode(), "anna_k"
	_ = r.ReplaceLinkCode(ctx, f.user, code, time.Now().Add(10*time.Minute))
	if ok, err := r.BindTelegram(ctx, code, 1003, &name, time.Now()); err != nil || !ok {
		t.Fatalf("ok=%v err=%v", ok, err)
	}
	if ok, err := r.BindTelegram(ctx, code, 2003, nil, time.Now()); err != nil || ok {
		t.Errorf("second use: ok=%v err=%v", ok, err)
	}
	chat, got := telegramOf(t, f, f.user)
	if chat == nil || *chat != 1003 || got == nil || *got != "anna_k" {
		t.Errorf("chat=%v name=%v: the used code must not rebind", chat, got)
	}
}

func TestTelegramRepo_ChatMovesToTheNewAccount(t *testing.T) {
	f := newMoveFixture(t)
	other := addUser(t, f, "user", false)
	r, ctx := NewTelegramRepository(f.pool), context.Background()
	c1, c2 := uniqueCode(), uniqueCode()
	_ = r.ReplaceLinkCode(ctx, f.user, c1, time.Now().Add(time.Minute))
	_ = r.ReplaceLinkCode(ctx, other, c2, time.Now().Add(time.Minute))
	if ok, err := r.BindTelegram(ctx, c1, 1004, nil, time.Now()); !ok || err != nil {
		t.Fatal(ok, err)
	}
	if ok, err := r.BindTelegram(ctx, c2, 1004, nil, time.Now()); !ok || err != nil {
		t.Fatal(ok, err)
	}
	if chat, _ := telegramOf(t, f, f.user); chat != nil {
		t.Error("the first account still has the chat")
	}
	if chat, _ := telegramOf(t, f, other); chat == nil || *chat != 1004 {
		t.Error("the second account did not get the chat")
	}
}

func linkedAtOf(t *testing.T, f moveFixture, user uuid.UUID) *time.Time {
	t.Helper()
	var at *time.Time
	if err := f.pool.QueryRow(context.Background(), `SELECT telegram_linked_at FROM users WHERE id = $1`, user).Scan(&at); err != nil {
		t.Fatal(err)
	}
	return at
}

func TestTelegramRepo_BindStampsLinkedAt_MovingTheChatClearsIt(t *testing.T) {
	f := newMoveFixture(t)
	other := addUser(t, f, "user", false)
	r, ctx := NewTelegramRepository(f.pool), context.Background()
	chat := time.Now().UnixNano()
	first := time.Now().Add(-time.Hour).UTC().Truncate(time.Microsecond)
	c1, c2 := uniqueCode(), uniqueCode()
	_ = r.ReplaceLinkCode(ctx, f.user, c1, time.Now().Add(time.Minute))
	_ = r.ReplaceLinkCode(ctx, other, c2, time.Now().Add(time.Minute))
	if ok, err := r.BindTelegram(ctx, c1, chat, nil, first); !ok || err != nil {
		t.Fatal(ok, err)
	}
	if at := linkedAtOf(t, f, f.user); at == nil || !at.Equal(first) {
		t.Fatalf("linked_at %v, want %v", at, first)
	}
	second := first.Add(30 * time.Minute)
	if ok, err := r.BindTelegram(ctx, c2, chat, nil, second); !ok || err != nil {
		t.Fatal(ok, err)
	}
	if at := linkedAtOf(t, f, f.user); at != nil {
		t.Errorf("the account that lost the chat still has linked_at %v", at)
	}
	if at := linkedAtOf(t, f, other); at == nil || !at.Equal(second) {
		t.Errorf("new account linked_at %v, want %v", at, second)
	}
}

func TestAdminRepo_TelegramStats(t *testing.T) {
	f := newMoveFixture(t)
	admin, ctx := NewAdminRepository(f.pool), context.Background()
	since := time.Now().AddDate(0, 0, -7)
	before, err := admin.TelegramStats(ctx, since)
	if err != nil {
		t.Fatal(err)
	}
	recent, old := addUser(t, f, "user", false), addUser(t, f, "user", false)
	addUser(t, f, "user", false) // never connected
	chat := time.Now().UnixNano()
	f.exec(t, `UPDATE users SET telegram_chat_id = $2, telegram_linked_at = now() - interval '1 day' WHERE id = $1`, recent, chat)
	f.exec(t, `UPDATE users SET telegram_chat_id = $2, telegram_linked_at = now() - interval '10 days' WHERE id = $1`, old, chat+1)

	after, err := admin.TelegramStats(ctx, since)
	if err != nil {
		t.Fatal(err)
	}
	if after.TotalUsers-before.TotalUsers != 3 || after.Connected-before.Connected != 2 || after.ConnectedLast7d-before.ConnectedLast7d != 1 {
		t.Errorf("before %+v, after %+v: want +3 users, +2 connected, +1 in 7 days", before, after)
	}
	if want := domain.NewTelegramStats(after.TotalUsers, after.Connected, after.ConnectedLast7d).Percent; after.Percent != want {
		t.Errorf("percent %v, want %v", after.Percent, want)
	}
}
