package postgres

import (
	"context"
	"errors"
	"math/rand/v2"
	"testing"
	"time"

	"github.com/google/uuid"

	"learnwords/internal/domain"
)

// testChat: chat ids are unique among users, so every test run uses its own.
func testChat() int64 { return 1e12 + rand.Int64N(1e12) }

func newTestLogin(t *testing.T, f moveFixture, now time.Time) (domain.TelegramLogin, *TelegramLoginRepository) {
	t.Helper()
	r := NewTelegramLoginRepository(f.pool)
	code, err := domain.NewTelegramLoginCode(nil)
	if err != nil {
		t.Fatal(err)
	}
	_, hash, _ := domain.NewTelegramLoginSecret(nil)
	l := domain.TelegramLogin{Code: code, SecretHash: hash, Device: "iPhone · Safari", ExpiresAt: now.Add(domain.TelegramLoginTTL), CreatedAt: now}
	if err := r.Create(context.Background(), l, now); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { f.pool.Exec(context.Background(), `DELETE FROM telegram_logins WHERE code = $1`, code) }) //nolint:errcheck
	return l, r
}

func TestTelegramLoginRepo_AskedOnceDecidedByThatChatCollectedOnce(t *testing.T) {
	f := newMoveFixture(t)
	ctx, now := context.Background(), time.Now()
	l, r := newTestLogin(t, f, now)
	if err := r.Create(ctx, l, now); !errors.Is(err, domain.ErrAlreadyExists) {
		t.Errorf("the same code twice: err = %v", err)
	}
	chat := testChat()
	asked, ok, err := r.Ask(ctx, l.Code, chat, now)
	if err != nil || !ok || asked.Status != domain.LoginAsked || *asked.ChatID != chat || asked.Device != "iPhone · Safari" {
		t.Fatalf("ask: %+v ok=%v err=%v", asked, ok, err)
	}
	if _, ok, _ := r.Ask(ctx, l.Code, chat+1, now); ok {
		t.Error("a second chat was asked too")
	}
	if ok, _ := r.Decide(ctx, l.Code, chat+1, now, domain.LoginConfirmed, &f.user, false); ok {
		t.Error("another chat confirmed the login")
	}
	if ok, err := r.Decide(ctx, l.Code, chat, now, domain.LoginConfirmed, &f.user, true); err != nil || !ok {
		t.Fatalf("decide: ok=%v err=%v", ok, err)
	}
	if ok, _ := r.Decide(ctx, l.Code, chat, now, domain.LoginDenied, nil, false); ok {
		t.Error("a decided login was decided again")
	}
	user, newUser, ok, err := r.Collect(ctx, l.SecretHash, now)
	if err != nil || !ok || user != f.user || !newUser {
		t.Fatalf("collect: %v %v ok=%v err=%v", user, newUser, ok, err)
	}
	if _, _, ok, _ := r.Collect(ctx, l.SecretHash, now); ok {
		t.Error("the session was collected twice")
	}
	if got, found, _ := r.BySecret(ctx, l.SecretHash); !found || got.Status != domain.LoginUsed || got.Code != l.Code {
		t.Errorf("by secret: %+v found=%v", got, found)
	}
}

func TestTelegramLoginRepo_ExpiredIsNotAskedDecidedOrCollected(t *testing.T) {
	f := newMoveFixture(t)
	ctx, now := context.Background(), time.Now()
	l, r := newTestLogin(t, f, now)
	late := l.ExpiresAt
	chat := testChat()
	if _, ok, _ := r.Ask(ctx, l.Code, chat, late); ok {
		t.Error("asked at expires_at")
	}
	if _, ok, _ := r.Ask(ctx, l.Code, chat, now); !ok {
		t.Fatal("not asked inside its 5 minutes")
	}
	if ok, _ := r.Decide(ctx, l.Code, chat, late, domain.LoginConfirmed, &f.user, false); ok {
		t.Error("decided at expires_at")
	}
	if ok, _ := r.Decide(ctx, l.Code, chat, now, domain.LoginConfirmed, &f.user, false); !ok {
		t.Fatal("not decided inside its 5 minutes")
	}
	if _, _, ok, _ := r.Collect(ctx, l.SecretHash, late); ok {
		t.Error("collected at expires_at")
	}
	// A new login deletes the expired ones.
	newTestLogin(t, f, late.Add(time.Second))
	if _, found, _ := r.Get(ctx, l.Code); found {
		t.Error("the expired login was not deleted")
	}
}

func TestUserRepo_FindOrCreateTelegramUser(t *testing.T) {
	pool := testPool(t)
	users, ctx, now := NewUserRepository(pool), context.Background(), time.Now().UTC().Truncate(time.Second)
	chat := testChat()
	candidate := func() *domain.User {
		return &domain.User{ID: uuid.New(), Email: domain.TelegramEmail(chat), PasswordHash: "x", Role: domain.RoleUser,
			LearningLanguage: domain.DefaultLearningLang, NeedsLanguage: true, CreatedAt: now, UpdatedAt: now}
	}
	first := candidate()
	t.Cleanup(func() { pool.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, first.ID) }) //nolint:errcheck
	name, username := "Anna Karimova", "anna_k"
	p := domain.TelegramProfile{ChatID: chat, Username: &username, FullName: &name, Lang: "uz", CreatedAt: now}

	got, created, err := users.FindOrCreateTelegramUser(ctx, first, p)
	if err != nil || !created || got.ID != first.ID || !got.NeedsLanguage {
		t.Fatalf("create: %+v created=%v err=%v", got, created, err)
	}
	byChat, err := users.GetByTelegramChat(ctx, chat)
	if err != nil || byChat.ID != first.ID || !byChat.NeedsLanguage || byChat.Email != domain.TelegramEmail(chat) || byChat.Role != domain.RoleUser {
		t.Fatalf("by chat: %+v err=%v", byChat, err)
	}
	var fullName, tgName, tgLang *string
	var linkedAt *time.Time
	if err := pool.QueryRow(ctx, `SELECT full_name, telegram_username, telegram_lang, telegram_linked_at FROM users WHERE id = $1`, first.ID).
		Scan(&fullName, &tgName, &tgLang, &linkedAt); err != nil {
		t.Fatal(err)
	}
	if *fullName != name || *tgName != username || *tgLang != "uz" || linkedAt == nil {
		t.Errorf("columns: %v %v %v %v", *fullName, *tgName, *tgLang, linkedAt)
	}
	// The chat's user exists: nothing new.
	if got, created, err := users.FindOrCreateTelegramUser(ctx, candidate(), p); err != nil || created || got.ID != first.ID {
		t.Errorf("again: %+v created=%v err=%v", got, created, err)
	}
	// The chat was moved to another account (linked there): its own account gets it back.
	if _, err := pool.Exec(ctx, `UPDATE users SET telegram_chat_id = NULL WHERE id = $1`, first.ID); err != nil {
		t.Fatal(err)
	}
	if got, created, err := users.FindOrCreateTelegramUser(ctx, candidate(), p); err != nil || created || got.ID != first.ID {
		t.Errorf("orphaned account: %+v created=%v err=%v", got, created, err)
	}
	if u, err := users.GetByTelegramChat(ctx, chat); err != nil || u.ID != first.ID {
		t.Errorf("chat not bound again: %+v err=%v", u, err)
	}
	if _, err := users.GetByTelegramChat(ctx, testChat()); !errors.Is(err, domain.ErrNotFound) {
		t.Errorf("unknown chat: err = %v", err)
	}

	// The learning language: chosen once.
	if ok, err := users.SetFirstLearningLanguage(ctx, first.ID, "ko"); err != nil || !ok {
		t.Fatalf("first choice: ok=%v err=%v", ok, err)
	}
	if ok, _ := users.SetFirstLearningLanguage(ctx, first.ID, "fr"); ok {
		t.Error("chosen twice")
	}
	if u, _ := users.GetByID(ctx, first.ID); u.LearningLanguage != "ko" || u.NeedsLanguage {
		t.Errorf("after the choice: %+v", u)
	}
}

func TestUserRepo_RegisteredAccountsNeverNeedTheLanguage(t *testing.T) {
	f := newMoveFixture(t)
	users := NewUserRepository(f.pool)
	if u, err := users.GetByID(context.Background(), f.user); err != nil || u.NeedsLanguage {
		t.Errorf("%+v err=%v", u, err)
	}
	if ok, _ := users.SetFirstLearningLanguage(context.Background(), f.user, "fr"); ok {
		t.Error("a registered account changed its learning language")
	}
}
