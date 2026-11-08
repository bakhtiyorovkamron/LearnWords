package postgres

import (
	"context"
	"errors"
	"sync"
	"testing"

	"github.com/google/uuid"

	"learnwords/internal/domain"
)

func strp(s string) *string { return &s }

func TestPurchaseChat_MessagesVisibilityUnreadAndSystemLines(t *testing.T) {
	f := newMoveFixture(t)
	admin := addUser(t, f, "admin", false)
	repo, ctx := NewPurchaseRepository(f.pool), context.Background()
	pack, _ := domain.PackByID("photo_35")
	p, err := repo.Create(ctx, f.user, pack, 3)
	if err != nil {
		t.Fatal(err)
	}
	say := func(role string, who uuid.UUID, body string, hidden bool) domain.PurchaseMessage {
		t.Helper()
		m := domain.PurchaseMessage{RequestID: p.ID, AuthorRole: role, AuthorUserID: &who, Body: strp(body), Hidden: hidden}
		if hidden {
			m.HiddenReason = strp(domain.HiddenCardNumber)
		}
		saved, err := repo.AddMessage(ctx, m, nil)
		if err != nil {
			t.Fatal(err)
		}
		return saved
	}
	b1 := say("buyer", f.user, "чек ниже", false)
	b2 := say("buyer", f.user, "карта (скрыто)", true)
	a1 := say("admin", admin, "скрытое от покупателя", true)

	got, err := repo.Get(ctx, p.ID)
	if err != nil || got.Unread != 0 || got.LastMessageAt == nil || !got.LastMessageAt.Equal(a1.CreatedAt) || got.UserEmail == "" {
		t.Fatalf("after the admin wrote: %+v %v (an admin's message marks the chat read)", got, err)
	}
	b3 := say("buyer", f.user, "ещё", false)
	if got, _ := repo.Get(ctx, p.ID); got.Unread != 1 {
		t.Errorf("unread %d, want 1", got.Unread)
	}
	list, _ := repo.ListByStatus(ctx, domain.PurchasePending, 200)
	for _, r := range list {
		if r.ID == p.ID && r.Unread != 1 {
			t.Errorf("listing unread %d", r.Unread)
		}
	}
	if err := repo.MarkAdminRead(ctx, p.ID, b3.ID); err != nil {
		t.Fatal(err)
	}
	if err := repo.MarkAdminRead(ctx, p.ID, b1.ID); err != nil { // never moves back
		t.Fatal(err)
	}
	if got, _ := repo.Get(ctx, p.ID); got.Unread != 0 {
		t.Errorf("unread after reading %d", got.Unread)
	}

	ids := func(ms []domain.PurchaseMessage) []int64 {
		out := []int64{}
		for _, m := range ms {
			out = append(out, m.ID)
		}
		return out
	}
	buyer, _ := repo.Messages(ctx, p.ID, 0, 50, "buyer")
	if want := []int64{b1.ID, b2.ID, b3.ID}; !equalIDs(ids(buyer), want) {
		t.Errorf("buyer sees %v, want %v (own hidden yes, the admin's hidden no)", ids(buyer), want)
	}
	all, _ := repo.Messages(ctx, p.ID, 0, 50, "admin")
	if want := []int64{b1.ID, b2.ID, a1.ID, b3.ID}; !equalIDs(ids(all), want) {
		t.Errorf("admin sees %v, want %v", ids(all), want)
	}
	if after, _ := repo.Messages(ctx, p.ID, b2.ID, 50, "admin"); !equalIDs(ids(after), []int64{a1.ID, b3.ID}) {
		t.Errorf("after: %v", ids(after))
	}
	if two, _ := repo.Messages(ctx, p.ID, 0, 2, "buyer"); !equalIDs(ids(two), []int64{b1.ID, b2.ID}) {
		t.Errorf("limit: the limit counts visible messages only, got %v", ids(two))
	}

	// Approve: paid, a system line, and writing still works.
	paid, err := repo.Approve(ctx, p.ID, admin)
	if err != nil || paid.Status != domain.PurchasePaid {
		t.Fatal(paid, err)
	}
	msgs, _ := repo.Messages(ctx, p.ID, b3.ID, 50, "buyer")
	if len(msgs) != 1 || msgs[0].AuthorRole != "system" || *msgs[0].Event != "paid" || *msgs[0].Body != "Оплата подтверждена, +35 фото" {
		t.Fatalf("system line %+v", msgs)
	}
	say("buyer", f.user, "спасибо", false)

	// Cancel and reject: "cancelled", and no more messages.
	c, _ := repo.Create(ctx, f.user, pack, 3)
	if err := repo.Cancel(ctx, f.user, c.ID); err != nil {
		t.Fatal(err)
	}
	r, _ := repo.Create(ctx, f.user, pack, 3)
	if _, err := repo.Reject(ctx, r.ID, admin); err != nil {
		t.Fatal(err)
	}
	for _, id := range []uuid.UUID{c.ID, r.ID} {
		msgs, _ := repo.Messages(ctx, id, 0, 50, "buyer")
		if len(msgs) != 1 || *msgs[0].Event != "cancelled" || *msgs[0].Body != "Заявка отменена" {
			t.Errorf("closed request lines %+v", msgs)
		}
		_, err := repo.AddMessage(ctx, domain.PurchaseMessage{RequestID: id, AuthorRole: "buyer", Body: strp("x")}, nil)
		if !errors.Is(err, domain.ErrChatClosed) {
			t.Errorf("message to a closed request: %v", err)
		}
	}
	if _, err := repo.AddMessage(ctx, domain.PurchaseMessage{RequestID: uuid.New(), AuthorRole: "buyer", Body: strp("x")}, nil); !errors.Is(err, domain.ErrPurchaseNotFound) {
		t.Errorf("missing request: %v", err)
	}
	if _, err := repo.Get(ctx, uuid.New()); !errors.Is(err, domain.ErrPurchaseNotFound) {
		t.Errorf("get missing: %v", err)
	}
}

func equalIDs(a, b []int64) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func TestPurchaseChat_ImagesAndCascade(t *testing.T) {
	f := newMoveFixture(t)
	repo, ctx := NewPurchaseRepository(f.pool), context.Background()
	pack, _ := domain.PackByID("photo_35")
	p, _ := repo.Create(ctx, f.user, pack, 3)
	key := "pm_" + uuid.NewString()
	img := &domain.ChatImage{Key: key, ContentType: "image/png", Data: []byte("\x89PNG fake bytes")}
	m, err := repo.AddMessage(ctx, domain.PurchaseMessage{RequestID: p.ID, AuthorRole: "buyer", AuthorUserID: &f.user, ImageKey: &key}, img)
	if err != nil {
		t.Fatal(err)
	}
	gotMsg, gotImg, err := repo.MessageImage(ctx, p.ID, m.ID)
	if err != nil || gotMsg.ID != m.ID || gotImg.ContentType != "image/png" || string(gotImg.Data) != string(img.Data) {
		t.Fatalf("image %+v %v", gotImg, err)
	}
	if _, _, err := repo.MessageImage(ctx, uuid.New(), m.ID); !errors.Is(err, domain.ErrNotFound) {
		t.Errorf("another request's message: %v", err)
	}
	text, _ := repo.AddMessage(ctx, domain.PurchaseMessage{RequestID: p.ID, AuthorRole: "buyer", Body: strp("без фото")}, nil)
	if _, _, err := repo.MessageImage(ctx, p.ID, text.ID); !errors.Is(err, domain.ErrNotFound) {
		t.Errorf("message without a photo: %v", err)
	}
	// A message with neither text nor photo is refused by the database too.
	if _, err := repo.AddMessage(ctx, domain.PurchaseMessage{RequestID: p.ID, AuthorRole: "buyer"}, nil); err == nil {
		t.Error("an empty message was stored")
	}

	// Deleting the user deletes the request, its messages and its photos.
	f.exec(t, `DELETE FROM users WHERE id = $1`, f.user)
	var n int
	if err := f.pool.QueryRow(ctx, `SELECT (SELECT count(*) FROM purchase_messages WHERE request_id = $1) + (SELECT count(*) FROM purchase_message_images WHERE request_id = $1)`, p.ID).Scan(&n); err != nil || n != 0 {
		t.Errorf("left behind: %d %v", n, err)
	}
}

// A cancel racing a message: either the message lands first (and the cancel line after it), or it
// is refused — never a buyer message after the "cancelled" line.
func TestPurchaseChat_CancelRacingAMessage(t *testing.T) {
	f := newMoveFixture(t)
	repo, ctx := NewPurchaseRepository(f.pool), context.Background()
	pack, _ := domain.PackByID("photo_35")
	for range 10 {
		p, err := repo.Create(ctx, f.user, pack, 3)
		if err != nil {
			t.Fatal(err)
		}
		var wg sync.WaitGroup
		wg.Add(2)
		go func() { defer wg.Done(); _ = repo.Cancel(ctx, f.user, p.ID) }()
		go func() {
			defer wg.Done()
			_, _ = repo.AddMessage(ctx, domain.PurchaseMessage{RequestID: p.ID, AuthorRole: "buyer", Body: strp("x")}, nil)
		}()
		wg.Wait()
		msgs, _ := repo.Messages(ctx, p.ID, 0, 50, "admin")
		last := msgs[len(msgs)-1]
		if last.AuthorRole != "system" || *last.Event != "cancelled" {
			t.Fatalf("lines %+v: the cancel line must come last", msgs)
		}
	}
}
