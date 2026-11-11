package postgres

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"

	"learnwords/internal/domain"
	"learnwords/internal/service"
)

// tgUser adds a user with the given Telegram state.
func tgUser(t *testing.T, f moveFixture, chat int64, notifications bool, blocked, banned bool, lang string) uuid.UUID {
	t.Helper()
	u := addUser(t, f, "user", banned)
	f.exec(t, `UPDATE users SET telegram_chat_id = $2, telegram_notifications = $3,
		telegram_blocked_at = CASE WHEN $4 THEN now() END, telegram_lang = NULLIF($5, '') WHERE id = $1`, u, chat, notifications, blocked, lang)
	return u
}

func recipientsOf(t *testing.T, f moveFixture, id int64) map[uuid.UUID]string {
	t.Helper()
	rows, err := f.pool.Query(context.Background(), `SELECT user_id, status FROM telegram_broadcast_recipients WHERE broadcast_id = $1`, id)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	out := map[uuid.UUID]string{}
	for rows.Next() {
		var u uuid.UUID
		var s string
		if err := rows.Scan(&u, &s); err != nil {
			t.Fatal(err)
		}
		out[u] = s
	}
	return out
}

func chatSeq() int64 { return time.Now().UnixNano()%1_000_000_000 + 1_000_000_000 }

func TestBroadcast_SnapshotExcludesOptedOutBlockedBannedAndUnlinked(t *testing.T) {
	f := newMoveFixture(t)
	admin := addUser(t, f, "admin", false)
	r, ctx := NewTelegramBroadcastRepository(f.pool), context.Background()
	before, _ := r.Audience(ctx)
	base := chatSeq()
	ok1 := tgUser(t, f, base+1, true, false, false, "uz")
	ok2 := tgUser(t, f, base+2, true, false, false, "")
	optedOut := tgUser(t, f, base+3, false, false, false, "")
	blocked := tgUser(t, f, base+4, true, true, false, "")
	banned := tgUser(t, f, base+5, true, false, true, "")
	unlinked := addUser(t, f, "user", false)

	text := domain.BroadcastText{RU: "Привет"}

	// "users": the reachable of the asked ones; the others are skipped.
	b, skipped, err := r.CreateBroadcast(ctx, domain.BroadcastParams{AdminID: admin, Target: "users", Text: text,
		UserIDs: []uuid.UUID{ok1, ok2, optedOut, blocked, banned, unlinked, uuid.New()}})
	if err != nil {
		t.Fatal(err)
	}
	if b.Total != 2 || skipped != 5 || b.Status != domain.BroadcastQueued || b.Target != "users" {
		t.Errorf("users: %+v skipped %d", b, skipped)
	}
	rs := recipientsOf(t, f, b.ID)
	if len(rs) != 2 || rs[ok1] != "pending" || rs[ok2] != "pending" {
		t.Errorf("recipients %v", rs)
	}

	// "all": the same rule over everyone.
	all, _, err := r.CreateBroadcast(ctx, domain.BroadcastParams{AdminID: admin, Target: "all", Text: text})
	if err != nil {
		t.Fatal(err)
	}
	rs = recipientsOf(t, f, all.ID)
	for _, u := range []uuid.UUID{optedOut, blocked, banned, unlinked} {
		if _, in := rs[u]; in {
			t.Errorf("user %v is in the snapshot", u)
		}
	}
	if _, in := rs[ok1]; !in || len(rs) != all.Total {
		t.Errorf("all: %d recipients, total %d", len(rs), all.Total)
	}

	// The audience counts.
	after, _ := r.Audience(ctx)
	if after.Linked != before.Linked+5 || after.Reachable != before.Reachable+2 || after.OptedOut != before.OptedOut+1 || after.Blocked != before.Blocked+1 {
		t.Errorf("audience before %+v after %+v", before, after)
	}
}

func TestBroadcast_OnlyOneAllAtATime_MeNeedsTelegram(t *testing.T) {
	f := newMoveFixture(t)
	admin := addUser(t, f, "admin", false)
	r, ctx := NewTelegramBroadcastRepository(f.pool), context.Background()
	f.exec(t, `UPDATE telegram_broadcasts SET status = 'interrupted' WHERE target = 'all' AND status IN ('queued', 'running')`)
	text := domain.BroadcastText{RU: "x"}

	first, _, err := r.CreateBroadcast(ctx, domain.BroadcastParams{AdminID: admin, Target: "all", Text: text})
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := r.CreateBroadcast(ctx, domain.BroadcastParams{AdminID: admin, Target: "all", Text: text}); !errors.Is(err, domain.ErrBroadcastRunning) {
		t.Errorf("a second all while queued: %v", err)
	}
	// Other targets are not blocked by it.
	tgAdmin := tgUser(t, f, chatSeq(), true, false, false, "")
	if _, _, err := r.CreateBroadcast(ctx, domain.BroadcastParams{AdminID: tgAdmin, Target: "me", Text: text}); err != nil {
		t.Errorf("me while an all runs: %v", err)
	}
	f.exec(t, `UPDATE telegram_broadcasts SET status = 'running' WHERE id = $1`, first.ID)
	if _, _, err := r.CreateBroadcast(ctx, domain.BroadcastParams{AdminID: admin, Target: "all", Text: text}); !errors.Is(err, domain.ErrBroadcastRunning) {
		t.Errorf("a second all while running: %v", err)
	}
	f.exec(t, `UPDATE telegram_broadcasts SET status = 'done' WHERE id = $1`, first.ID)
	f.exec(t, `UPDATE telegram_broadcasts SET status = 'done' WHERE target = 'all' AND status = 'queued'`)
	if _, _, err := r.CreateBroadcast(ctx, domain.BroadcastParams{AdminID: admin, Target: "all", Text: text}); err != nil {
		t.Errorf("an all after the first finished: %v", err)
	}

	// "me": the admin must have Telegram linked; opting out does not matter for a test.
	if _, _, err := r.CreateBroadcast(ctx, domain.BroadcastParams{AdminID: admin, Target: "me", Text: text}); !errors.Is(err, domain.ErrTelegramNotLinked) {
		t.Errorf("me without telegram: %v", err)
	}
	f.exec(t, `UPDATE users SET telegram_notifications = false WHERE id = $1`, tgAdmin)
	me, _, err := r.CreateBroadcast(ctx, domain.BroadcastParams{AdminID: tgAdmin, Target: "me", Text: text})
	if err != nil || me.Total != 1 {
		t.Errorf("me, opted out: %+v %v", me, err)
	}
	if rs, _ := r.PendingRecipients(ctx, me.ID, "me", 10); len(rs) != 1 || !rs[0].Reachable {
		t.Errorf("a test to yourself stays reachable: %+v", rs)
	}
}

// The whole path with the real repository: language, 403, the counters, nothing twice.
func TestBroadcast_WorkerEndToEnd(t *testing.T) {
	f := newMoveFixture(t)
	admin := addUser(t, f, "admin", false)
	repo, ctx := NewTelegramBroadcastRepository(f.pool), context.Background()
	f.exec(t, `UPDATE telegram_broadcasts SET status = 'interrupted' WHERE status IN ('queued', 'running')`)
	base := chatSeq()
	ru := tgUser(t, f, base+1, true, false, false, "")
	uz := tgUser(t, f, base+2, true, false, false, "uz")
	gone := tgUser(t, f, base+3, true, false, false, "en")
	// Only these three are asked for: the other users in the shared test database are not involved.
	bot := &endBot{blockChat: base + 3}
	svc := service.NewTelegramBroadcastService(repo, bot, true)
	run, stop := context.WithCancel(ctx)
	defer stop()
	if err := svc.Start(run); err != nil {
		t.Fatal(err)
	}
	b, skipped, err := svc.Create(run, admin, "users", []uuid.UUID{ru, uz, gone, uuid.New()}, "Привет", "Salom", "", &domain.TelegramButton{Text: "Open", URL: "https://yodla.fun"})
	if err != nil || skipped != 1 || b.Total != 3 {
		t.Fatalf("create: %+v %d %v", b, skipped, err)
	}
	var got domain.TelegramBroadcast
	for deadline := time.Now().Add(10 * time.Second); time.Now().Before(deadline); time.Sleep(50 * time.Millisecond) {
		got, _ = repo.Get(ctx, b.ID)
		if got.Status == domain.BroadcastDone {
			break
		}
	}
	stop()
	svc.Wait()
	if got.Status != domain.BroadcastDone || got.Sent != 2 || got.Blocked != 1 || got.Failed != 0 || got.FinishedAt == nil {
		t.Fatalf("broadcast %+v", got)
	}
	if bot.texts[base+1] != "Привет" || bot.texts[base+2] != "Salom" || bot.buttons != 2 {
		t.Errorf("texts %v buttons %d", bot.texts, bot.buttons)
	}
	var blockedAt *time.Time
	if err := f.pool.QueryRow(ctx, `SELECT telegram_blocked_at FROM users WHERE id = $1`, gone).Scan(&blockedAt); err != nil || blockedAt == nil {
		t.Errorf("the 403 did not mark the user blocked (%v)", err)
	}
	// A restart: nothing is sent again, and an unfinished one is only marked interrupted.
	f.exec(t, `UPDATE telegram_broadcasts SET status = 'running' WHERE id = $1`, b.ID)
	svc2 := service.NewTelegramBroadcastService(repo, bot, true)
	run2, stop2 := context.WithCancel(ctx)
	if err := svc2.Start(run2); err != nil {
		t.Fatal(err)
	}
	time.Sleep(100 * time.Millisecond)
	stop2()
	svc2.Wait()
	after, _ := repo.Get(ctx, b.ID)
	if after.Status != domain.BroadcastInterrupted || bot.calls != 3 {
		t.Errorf("after a restart: %+v, %d sends in all", after, bot.calls)
	}
}

type endBot struct {
	blockChat int64
	texts     map[int64]string
	buttons   int
	calls     int
}

func (b *endBot) SendMessage(_ context.Context, chat int64, text string, btn *domain.TelegramButton) error {
	b.calls++
	if chat == b.blockChat {
		return domain.ErrBotBlocked
	}
	if b.texts == nil {
		b.texts = map[int64]string{}
	}
	b.texts[chat] = text
	if btn != nil {
		b.buttons++
	}
	return nil
}
func (b *endBot) SetWebhook(context.Context, string, string) error { return nil }

func TestTelegramRepo_SwitchesBlockedAndLanguage(t *testing.T) {
	f := newMoveFixture(t)
	r, ctx := NewTelegramRepository(f.pool), context.Background()
	chat := chatSeq()
	u := tgUser(t, f, chat, true, false, false, "")

	if err := r.MarkBlocked(ctx, u); err != nil {
		t.Fatal(err)
	}
	if _, found, _ := r.ChatID(ctx, u); found {
		t.Error("ChatID returns a blocked user's chat")
	}
	if err := r.ClearChatBlocked(ctx, chat); err != nil {
		t.Fatal(err)
	}
	if id, found, _ := r.ChatID(ctx, u); !found || id != chat {
		t.Error("ChatID after unblocking")
	}
	if linked, err := r.SetChatNotifications(ctx, chat, false); err != nil || !linked {
		t.Fatalf("/stop: %v %v", linked, err)
	}
	var on bool
	_ = f.pool.QueryRow(ctx, `SELECT telegram_notifications FROM users WHERE id = $1`, u).Scan(&on)
	if on {
		t.Error("/stop did not switch notifications off")
	}
	if err := r.SetNotifications(ctx, u, true); err != nil {
		t.Fatal(err)
	}
	_ = f.pool.QueryRow(ctx, `SELECT telegram_notifications FROM users WHERE id = $1`, u).Scan(&on)
	if !on {
		t.Error("the profile switch did not turn it on")
	}
	if linked, _ := r.SetChatNotifications(ctx, chat+999, false); linked {
		t.Error("an unknown chat is linked")
	}
	if err := r.SetChatLang(ctx, chat, "uz"); err != nil {
		t.Fatal(err)
	}
	var lang *string
	_ = f.pool.QueryRow(ctx, `SELECT telegram_lang FROM users WHERE id = $1`, u).Scan(&lang)
	if lang == nil || *lang != "uz" {
		t.Errorf("lang %v", lang)
	}
	if err := r.SetNotifications(ctx, uuid.New(), true); !errors.Is(err, domain.ErrNotFound) {
		t.Errorf("unknown user: %v", err)
	}
}
