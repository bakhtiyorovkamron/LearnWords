package postgres

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	"learnwords/internal/domain"
	"learnwords/internal/service"
)

func TestSupport_OneThreadPerUser_EvenAtOnce(t *testing.T) {
	f := newMoveFixture(t)
	other := addUser(t, f, "user", false)
	r, ctx := NewSupportRepository(f.pool), context.Background()

	ids := make([]int64, 10)
	var wg sync.WaitGroup
	for i := range ids {
		wg.Add(1)
		go func() {
			defer wg.Done()
			th, err := r.EnsureThread(ctx, f.user)
			if err != nil {
				t.Error(err)
				return
			}
			ids[i] = th.ID
		}()
	}
	wg.Wait()
	for _, id := range ids {
		if id != ids[0] {
			t.Fatalf("threads %v: want one", ids)
		}
	}
	var n int
	if err := f.pool.QueryRow(ctx, `SELECT count(*) FROM chat_threads WHERE kind = 'support' AND user_id = $1`, f.user).Scan(&n); err != nil || n != 1 {
		t.Errorf("%d support threads for the user (%v)", n, err)
	}
	theirs, _ := r.EnsureThread(ctx, other)
	if theirs.ID == ids[0] || theirs.UserID != other || theirs.Kind != "support" {
		t.Errorf("the other user's thread %+v", theirs)
	}
	if _, err := r.EnsureThread(ctx, uuid.New()); !errors.Is(err, domain.ErrNotFound) {
		t.Errorf("no such user: %v", err)
	}
}

func TestSupport_MessagesUnreadReadAndTheAdminList(t *testing.T) {
	f := newMoveFixture(t)
	admin, quiet := addUser(t, f, "admin", false), addUser(t, f, "user", false)
	other := addUser(t, f, "user", false)
	r, ctx := NewSupportRepository(f.pool), context.Background()
	mine, _ := r.EnsureThread(ctx, f.user)
	theirs, _ := r.EnsureThread(ctx, other)
	_, _ = r.EnsureThread(ctx, quiet) // a thread without messages: not listed

	say := func(th int64, role string, who uuid.UUID, body string, hidden bool) domain.ChatMessage {
		t.Helper()
		m := domain.ChatMessage{AuthorRole: role, AuthorUserID: &who, Body: strp(body), Hidden: hidden}
		saved, err := r.AddMessage(ctx, th, m, nil)
		if err != nil {
			t.Fatal(err)
		}
		return saved
	}
	u1 := say(mine.ID, "user", f.user, "Здравствуйте, не приходят фото", false)
	u2 := say(mine.ID, "user", f.user, "карта (скрыто)", true)
	a1 := say(mine.ID, "admin", admin, "скрыто от пользователя", true)
	u3 := say(mine.ID, "user", f.user, "спасибо", false)
	time.Sleep(10 * time.Millisecond)
	o1 := say(theirs.ID, "user", other, "вопрос", false)

	// Visibility: the user also sees their own hidden message, not the admin's; admins see all.
	userView, _ := r.Messages(ctx, mine.ID, 0, 50, "user")
	if got := idsOf(userView); !equalIDs(got, []int64{u1.ID, u2.ID, u3.ID}) {
		t.Errorf("user sees %v", got)
	}
	adminView, _ := r.Messages(ctx, mine.ID, 0, 50, "admin")
	if got := idsOf(adminView); !equalIDs(got, []int64{u1.ID, u2.ID, a1.ID, u3.ID}) {
		t.Errorf("admin sees %v", got)
	}
	if got, _ := r.Messages(ctx, mine.ID, a1.ID, 50, "user"); !equalIDs(idsOf(got), []int64{u3.ID}) {
		t.Errorf("after: %v", idsOf(got))
	}
	if other, _ := r.Messages(ctx, theirs.ID, 0, 50, "user"); !equalIDs(idsOf(other), []int64{o1.ID}) {
		t.Errorf("the other thread: %v", idsOf(other))
	}

	// The admin's message marked the thread read up to itself: only u3 is unread.
	th, err := r.Thread(ctx, mine.ID)
	if err != nil || th.Unread != 1 || th.UserEmail == "" || th.LastMessageAt == nil || !th.LastMessageAt.Equal(u3.CreatedAt) {
		t.Fatalf("thread %+v %v", th, err)
	}

	list, err := r.Threads(ctx, false, 200)
	if err != nil {
		t.Fatal(err)
	}
	pos := map[int64]int{}
	for i, x := range list {
		pos[x.ID] = i
		if x.Kind != "support" {
			t.Errorf("a %s thread in the support list", x.Kind)
		}
	}
	if _, listed := pos[mine.ID]; !listed {
		t.Fatal("my thread is not listed")
	}
	if pos[theirs.ID] > pos[mine.ID] {
		t.Error("the newest conversation must come first")
	}
	for _, x := range list {
		if x.UserID == quiet {
			t.Error("a thread without messages is listed")
		}
		if x.ID == mine.ID && (x.Unread != 1 || x.LastMessage == nil || x.LastMessage.ID != u3.ID) {
			t.Errorf("my thread in the list %+v", x)
		}
	}

	// unread=1 and reading.
	unread, _ := r.Threads(ctx, true, 200)
	if !hasThread(unread, mine.ID) || !hasThread(unread, theirs.ID) {
		t.Error("both threads have unread messages")
	}
	if err := r.MarkRead(ctx, mine.ID, 0); err != nil { // 0 = everything
		t.Fatal(err)
	}
	if th, _ := r.Thread(ctx, mine.ID); th.Unread != 0 {
		t.Errorf("unread after reading all: %d", th.Unread)
	}
	if unread, _ := r.Threads(ctx, true, 200); hasThread(unread, mine.ID) {
		t.Error("a read thread is in the unread list")
	}
	u4 := say(mine.ID, "user", f.user, "ещё вопрос", false)
	say(mine.ID, "user", f.user, "и ещё", false)
	if err := r.MarkRead(ctx, mine.ID, u4.ID); err != nil {
		t.Fatal(err)
	}
	if th, _ := r.Thread(ctx, mine.ID); th.Unread != 1 {
		t.Errorf("read up to u4: unread %d, want 1", th.Unread)
	}
	if err := r.MarkRead(ctx, mine.ID, u1.ID); err != nil { // never moves back
		t.Fatal(err)
	}
	if th, _ := r.Thread(ctx, mine.ID); th.Unread != 1 {
		t.Errorf("the read mark moved back: unread %d", th.Unread)
	}
}

func idsOf(ms []domain.ChatMessage) []int64 {
	out := []int64{}
	for _, m := range ms {
		out = append(out, m.ID)
	}
	return out
}

func hasThread(ts []domain.ChatThread, id int64) bool {
	for _, x := range ts {
		if x.ID == id {
			return true
		}
	}
	return false
}

func TestSupport_PurchaseThreadsAreNotSupportThreads_PhotosAndCascade(t *testing.T) {
	f := newMoveFixture(t)
	r, purchases, ctx := NewSupportRepository(f.pool), NewPurchaseRepository(f.pool), context.Background()
	pack, _ := domain.PackByID("photo_35")
	p, _ := purchases.Create(ctx, f.user, pack, 3)
	if _, err := purchases.AddMessage(ctx, p.ID, domain.ChatMessage{AuthorRole: "user", Body: strp("по заявке")}, nil); err != nil {
		t.Fatal(err)
	}
	var purchaseThread int64
	if err := f.pool.QueryRow(ctx, `SELECT id FROM chat_threads WHERE purchase_request_id = $1`, p.ID).Scan(&purchaseThread); err != nil {
		t.Fatal(err)
	}
	if _, err := r.Thread(ctx, purchaseThread); !errors.Is(err, domain.ErrNotFound) {
		t.Errorf("a purchase thread through the support repository: %v", err)
	}

	mine, _ := r.EnsureThread(ctx, f.user)
	if mine.ID == purchaseThread {
		t.Fatal("the support thread is the purchase thread")
	}
	key := "pm_" + uuid.NewString()
	img := &domain.ChatImage{Key: key, ContentType: "image/png", Data: []byte("\x89PNG fake")}
	m, err := r.AddMessage(ctx, mine.ID, domain.ChatMessage{AuthorRole: "user", ImageKey: &key}, img)
	if err != nil {
		t.Fatal(err)
	}
	if got, gotImg, err := r.MessageImage(ctx, mine.ID, m.ID); err != nil || got.ID != m.ID || string(gotImg.Data) != string(img.Data) {
		t.Errorf("image: %v", err)
	}
	if _, _, err := r.MessageImage(ctx, purchaseThread, m.ID); !errors.Is(err, domain.ErrNotFound) {
		t.Errorf("the photo through another thread: %v", err)
	}
	list, _ := r.Threads(ctx, false, 200)
	for _, x := range list {
		if x.ID == mine.ID && (x.LastMessage == nil || domain.ChatPreview(*x.LastMessage) != "[фото]") {
			t.Errorf("preview of a photo: %+v", x.LastMessage)
		}
	}

	f.exec(t, `DELETE FROM users WHERE id = $1`, f.user)
	var n int
	if err := f.pool.QueryRow(ctx, `SELECT (SELECT count(*) FROM chat_threads WHERE id IN ($1, $2))
		+ (SELECT count(*) FROM chat_messages WHERE thread_id IN ($1, $2)) + (SELECT count(*) FROM chat_images WHERE thread_id IN ($1, $2))`,
		mine.ID, purchaseThread).Scan(&n); err != nil || n != 0 {
		t.Errorf("left behind after deleting the user: %d %v", n, err)
	}
}

func TestSupport_AdminOpen_CreatesOnceForAnyUser_EmptyThreadNotListed(t *testing.T) {
	f := newMoveFixture(t)
	admin := addUser(t, f, "admin", false)
	r, ctx := NewSupportRepository(f.pool), context.Background()
	svc := service.NewSupportService(r, nil, nil)

	th, err := svc.AdminOpen(ctx, f.user)
	if err != nil || th.UserID != f.user || th.Kind != "support" || th.Unread != 0 || th.LastMessage != nil || th.UserEmail == "" {
		t.Fatalf("open: %+v %v", th, err)
	}
	again, err := svc.AdminOpen(ctx, f.user)
	if err != nil || again.ID != th.ID {
		t.Errorf("second open: %+v %v", again, err)
	}
	var n int
	if err := f.pool.QueryRow(ctx, `SELECT count(*) FROM chat_messages WHERE thread_id = $1`, th.ID).Scan(&n); err != nil || n != 0 {
		t.Errorf("%d messages, want none (%v)", n, err)
	}
	list := func() bool {
		ts, err := r.Threads(ctx, false, 1000)
		if err != nil {
			t.Fatal(err)
		}
		for _, x := range ts {
			if x.ID == th.ID {
				return true
			}
		}
		return false
	}
	if list() {
		t.Error("an empty thread is in the inbox")
	}
	if _, err := svc.AdminPost(ctx, admin, th.ID, "Здравствуйте", nil); err != nil {
		t.Fatal(err)
	}
	if !list() {
		t.Error("the thread is not in the inbox after the admin's message")
	}
	if _, err := svc.AdminOpen(ctx, uuid.New()); !errors.Is(err, domain.ErrNotFound) {
		t.Errorf("unknown user: %v", err)
	}
}
