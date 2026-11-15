package postgres

import (
	"context"
	"errors"
	"fmt"
	"math/rand"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	"learnwords/internal/domain"
	"learnwords/internal/service"
)

// limit50 is the rule as production builds it with the bot configured.
func limit50() domain.WordGuard { return service.NewWordLimit(nil, 50, true).Guard() }

func (f moveFixture) words(t *testing.T, user uuid.UUID, n int) {
	t.Helper()
	for i := 0; i < n; i++ {
		f.addUserWord(t, user, fmt.Sprintf("w%d", i))
	}
}

func (f moveFixture) userWordCount(t *testing.T, user uuid.UUID) int {
	return f.count(t, countUserWordsSQL, user)
}

// oneWord is what ContextService.Create hands the repository.
func oneWord(user uuid.UUID, word string) (*domain.Context, []domain.WordCard) {
	c := &domain.Context{ID: uuid.New(), UserID: user, SourceText: word, Meaning: "x", Language: "de", CreatedAt: time.Now().UTC()}
	return c, []domain.WordCard{{ID: uuid.New(), ContextID: c.ID, UserID: user, Word: word, Translation: "x", Language: "de", CreatedAt: c.CreatedAt}}
}

func TestWordLimitDB_49PlusOne_ThenTelegramRequired(t *testing.T) {
	f := newMoveFixture(t)
	repo := NewContextRepository(f.pool)
	ctx := context.Background()
	f.words(t, f.user, 49)

	c, cards := oneWord(f.user, "Hund")
	if err := repo.CreateWithCards(ctx, c, cards, limit50()); err != nil {
		t.Fatalf("the 50th word: %v", err)
	}
	c, cards = oneWord(f.user, "Katze")
	err := repo.CreateWithCards(ctx, c, cards, limit50())
	if limit, words, ok := domain.WordLimitOf(err); !ok || limit != 50 || words != 50 {
		t.Fatalf("the 51st word: %v", err)
	}
	if n := f.userWordCount(t, f.user); n != 50 {
		t.Errorf("count = %d, want 50", n)
	}
	if n := f.count(t, `SELECT count(*) FROM contexts WHERE id = $1`, c.ID); n != 0 {
		t.Error("the rejected word's context was saved")
	}
}

// Two (and ten) requests at 49 at the same moment: exactly one passes, the count ends at 50.
// The guard pauses after reading the count, inside the transaction: without the row lock every
// request would read 49 during that pause and pass (this test fails then — checked), with it the
// others wait and read the new count.
func TestWordLimitDB_ParallelAddsAt49_LeaveExactly50(t *testing.T) {
	slow := func(q domain.WordQuota, n int) error {
		time.Sleep(50 * time.Millisecond)
		return limit50()(q, n)
	}
	for _, parallel := range []int{2, 10} {
		t.Run(fmt.Sprint(parallel), func(t *testing.T) {
			f := newMoveFixture(t)
			repo := NewContextRepository(f.pool)
			f.words(t, f.user, 49)

			start := make(chan struct{})
			errs := make([]error, parallel)
			var wg sync.WaitGroup
			for i := 0; i < parallel; i++ {
				wg.Add(1)
				go func(i int) {
					defer wg.Done()
					c, cards := oneWord(f.user, fmt.Sprintf("parallel%d", i))
					<-start
					errs[i] = repo.CreateWithCards(context.Background(), c, cards, slow)
				}(i)
			}
			close(start)
			wg.Wait()

			ok, refused := 0, 0
			for _, err := range errs {
				switch {
				case err == nil:
					ok++
				case errors.Is(err, domain.ErrTelegramRequired):
					refused++
				default:
					t.Fatalf("unexpected error: %v", err)
				}
			}
			if ok != 1 || refused != parallel-1 {
				t.Errorf("%d passed, %d refused; want 1 and %d", ok, refused, parallel-1)
			}
			if n := f.userWordCount(t, f.user); n != 50 {
				t.Errorf("count = %d, want exactly 50", n)
			}
		})
	}
}

func TestWordLimitDB_LinkedAndAdminHaveNoLimit(t *testing.T) {
	ctx := context.Background()
	for name, set := range map[string]string{
		"linked": `UPDATE users SET telegram_chat_id = $2 WHERE id = $1`,
		"admin":  `UPDATE users SET role = 'admin' WHERE id = $1 AND $2::bigint IS NOT NULL`,
	} {
		f := newMoveFixture(t)
		f.words(t, f.user, 50)
		f.exec(t, set, f.user, rand.Int63())
		c, cards := oneWord(f.user, "Hund")
		if err := NewContextRepository(f.pool).CreateWithCards(ctx, c, cards, limit50()); err != nil {
			t.Errorf("%s: %v", name, err)
		}
	}
}

func TestWordLimitDB_80Words_CannotAddButCanReview(t *testing.T) {
	f := newMoveFixture(t)
	ctx := context.Background()
	past := time.Now().UTC().AddDate(0, 0, -3)
	for i := 0; i < 80; i++ {
		f.word(t, f.user, nil, past) // due for review
	}

	c, cards := oneWord(f.user, "Hund")
	err := NewContextRepository(f.pool).CreateWithCards(ctx, c, cards, limit50())
	if limit, words, ok := domain.WordLimitOf(err); !ok || limit != 50 || words != 80 {
		t.Fatalf("adding at 80: %v", err)
	}

	review := service.NewReviewService(NewReviewRepository(f.pool))
	due, total, err := review.Due(ctx, f.user, nil, "")
	if err != nil || len(due) == 0 || total != 80 {
		t.Fatalf("due: %d cards, total %d, %v", len(due), total, err)
	}
	if _, err := review.Answer(ctx, f.user, due[0].ID, true); err != nil {
		t.Fatalf("answering: %v", err)
	}
	if n := f.userWordCount(t, f.user); n != 80 {
		t.Errorf("nothing is deleted: count = %d", n)
	}
}

func TestWordLimitDB_SharedImport_AllOrNothing(t *testing.T) {
	ctx := context.Background()
	owner := newShareFixture(t)
	src := owner.folder(t, owner.user)
	for i := 0; i < 10; i++ {
		owner.sourceWord(t, owner.user, src, fmt.Sprintf("Wort%d", i), "слово")
	}
	tok, err := owner.repo.EnableShare(ctx, owner.user, src)
	if err != nil {
		t.Fatal(err)
	}

	me := newShareFixture(t)
	me.words(t, me.user, 45)
	_, err = me.repo.ImportShared(ctx, me.user, "de", tok, 100, limit50())
	if limit, words, ok := domain.WordLimitOf(err); !ok || limit != 50 || words != 45 {
		t.Fatalf("10 new words at 45: %v", err)
	}
	if n := me.userWordCount(t, me.user); n != 45 {
		t.Errorf("a part was imported: count = %d", n)
	}
	if n := me.count(t, `SELECT count(*) FROM folders WHERE user_id = $1`, me.user); n != 0 {
		t.Errorf("the folder was created anyway (%d)", n)
	}
	if n := me.count(t, `SELECT count(*) FROM folder_imports WHERE user_id = $1`, me.user); n != 0 {
		t.Error("the import was recorded")
	}

	// Words the user already has are not new: with 5 of the 10 at home, the other 5 fit exactly.
	for i := 0; i < 5; i++ {
		me.addUserWord(t, me.user, fmt.Sprintf("Wort%d", i))
	}
	me.exec(t, `DELETE FROM word_cards WHERE user_id = $1 AND word IN ('w0','w1','w2','w3','w4')`, me.user) // back to 45
	res, err := me.repo.ImportShared(ctx, me.user, "de", tok, 100, limit50())
	if err != nil || res.Added != 5 || res.Skipped != 5 {
		t.Fatalf("5 new words at 45: %+v %v", res, err)
	}
	if n := me.userWordCount(t, me.user); n != 50 {
		t.Errorf("count = %d, want 50", n)
	}
}

func TestWordLimitDB_StarterFolderOverTheLimitIsNotGiven(t *testing.T) {
	f := newMoveFixture(t)
	ctx := domain.WithTranslationLang(context.Background(), "ru")
	svc, err := service.NewStarterService(NewContextRepository(f.pool))
	if err != nil {
		t.Fatal(err)
	}
	err = svc.WithWordLimit(service.NewWordLimit(nil, 5, true)).Create(ctx, f.user, "de")
	if !errors.Is(err, domain.ErrTelegramRequired) {
		t.Fatalf("err = %v", err)
	}
	if n := f.count(t, `SELECT count(*) FROM folders WHERE user_id = $1`, f.user); n != 0 || f.userWordCount(t, f.user) != 0 {
		t.Error("a part of the starter folder was saved")
	}
}

// The admin list and the limit count the same words (one definition: userWords).
func TestWordLimitDB_SameCountAsTheAdminList(t *testing.T) {
	f := newMoveFixture(t)
	ctx := context.Background()
	f.words(t, f.user, 7)

	users, err := NewAdminRepository(f.pool).ListUsers(ctx)
	if err != nil {
		t.Fatal(err)
	}
	q, err := NewUserRepository(f.pool).WordQuota(ctx, f.user)
	if err != nil {
		t.Fatal(err)
	}
	for _, u := range users {
		if u.ID == f.user {
			if u.WordsCount != 7 || q.Words != 7 || u.LastActivityAt == nil {
				t.Errorf("admin list %d (last activity %v), quota %d; want 7", u.WordsCount, u.LastActivityAt, q.Words)
			}
			return
		}
	}
	t.Fatal("the user is not in the admin list")
}
