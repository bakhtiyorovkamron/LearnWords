package postgres

import (
	"context"
	"testing"

	"learnwords/internal/domain"
	"learnwords/internal/service"
)

// The whole path on the real database: the user writes, the admin answers in the thread from the
// admin list, and the user's read after their own message brings the answer. The user also has a
// purchase thread (created first), so a lookup without kind = 'support' would read the wrong one.
func TestSupportFlow_AdminReplyReachesTheUser(t *testing.T) {
	f := newMoveFixture(t)
	admin := addUser(t, f, "admin", false)
	ctx := context.Background()
	purchases := NewPurchaseRepository(f.pool)
	pack, _ := domain.PackByID("photo_35")
	p, _ := purchases.Create(ctx, f.user, pack, 3)
	if _, err := purchases.AddMessage(ctx, p.ID, domain.ChatMessage{AuthorRole: "user", Body: strp("по заявке")}, nil); err != nil {
		t.Fatal(err)
	}

	svc := service.NewSupportService(NewSupportRepository(f.pool), nil, nil)
	mine, err := svc.UserPost(ctx, f.user, "Где мои фото?", nil)
	if err != nil {
		t.Fatal(err)
	}
	threads, err := svc.Threads(ctx, false)
	if err != nil {
		t.Fatal(err)
	}
	var thread int64
	for _, th := range threads {
		if th.UserID == f.user {
			thread = th.ID
		}
	}
	if thread == 0 || thread != mine.ThreadID {
		t.Fatalf("the admin list has thread %d, the user wrote to %d", thread, mine.ThreadID)
	}
	reply, err := svc.AdminPost(ctx, admin, thread, "Уже начислили", nil)
	if err != nil {
		t.Fatal(err)
	}
	svc.Wait()

	th, msgs, err := svc.UserMessages(ctx, f.user, mine.ID)
	if err != nil {
		t.Fatal(err)
	}
	if th.ID != thread || th.Kind != domain.ChatKindSupport {
		t.Errorf("the user reads thread %+v", th)
	}
	if len(msgs) != 1 || msgs[0].ID != reply.ID || msgs[0].AuthorRole != "admin" || *msgs[0].Body != "Уже начислили" {
		t.Fatalf("after the user's message: %+v", msgs)
	}
	_, everything, _ := svc.UserMessages(ctx, f.user, 0)
	if len(everything) != 2 || everything[0].ID != mine.ID || everything[1].ID != reply.ID {
		t.Errorf("the whole thread, oldest first: %+v", everything)
	}
	for _, m := range everything {
		if m.Body != nil && *m.Body == "по заявке" {
			t.Error("the purchase thread's message is in the support thread")
		}
	}
}
