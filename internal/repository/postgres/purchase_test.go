package postgres

import (
	"context"
	"errors"
	"slices"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/google/uuid"

	"learnwords/internal/domain"
	"learnwords/internal/service"
)

// creditsFixture: a user with a purchased photo balance, and the service over the real repository.
type creditsFixture struct {
	moveFixture
	repo *FeatureRepository
	svc  *service.FeatureService
}

func newCreditsFixture(t *testing.T, credits int) creditsFixture {
	t.Helper()
	f := newMoveFixture(t)
	repo := NewFeatureRepository(f.pool)
	if credits > 0 {
		if _, err := repo.AddCredits(context.Background(), f.user, domain.FeaturePhotoImport, credits, domain.CreditAdmin, nil, nil, "test"); err != nil {
			t.Fatal(err)
		}
	}
	return creditsFixture{f, repo, service.NewFeatureService(repo)}
}

func (f creditsFixture) state(t *testing.T) domain.FeatureState {
	t.Helper()
	st, err := f.svc.State(context.Background(), f.user, domain.FeaturePhotoImport)
	if err != nil {
		t.Fatal(err)
	}
	return st
}

// addUser inserts another user (removed after the test).
func addUser(t *testing.T, f moveFixture, role string, banned bool) uuid.UUID {
	t.Helper()
	u := uuid.New()
	f.exec(t, `INSERT INTO users (id, email, password_hash, role, is_banned) VALUES ($1, $2, 'x', $3, $4)`, u, u.String()+"@test", role, banned)
	t.Cleanup(func() { f.pool.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, u) }) //nolint:errcheck
	return u
}

// 5 free photos a day + 3 purchased ones, hit by far more parallel requests: exactly 8 get through,
// and the balance ends at 0 without ever going below.
func TestCredits_ParallelConsumeUsesDailyThenCreditsExactly(t *testing.T) {
	f := newCreditsFixture(t, 3)
	ctx := context.Background()

	var ok, limited, fromDaily, fromCredits atomic.Int32
	var wg sync.WaitGroup
	for range 30 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			res, err := f.svc.Consume(ctx, f.user, domain.FeaturePhotoImport, 1)
			switch {
			case err == nil:
				ok.Add(1)
				fromDaily.Add(int32(res.FromDaily))
				fromCredits.Add(int32(res.FromCredits))
				if res.Credits < 0 || *res.DailyRemaining < 0 {
					t.Errorf("negative: %+v", res)
				}
			case errors.Is(err, domain.ErrDailyLimit):
				limited.Add(1)
				if n, _ := domain.CreditsOf(err); n != 0 {
					t.Errorf("refused while %d credits are left", n)
				}
			default:
				t.Error(err)
			}
		}()
	}
	wg.Wait()
	if ok.Load() != photoLimit+3 || limited.Load() != 30-photoLimit-3 || fromDaily.Load() != photoLimit || fromCredits.Load() != 3 {
		t.Fatalf("ok %d (daily %d, credits %d), limited %d", ok.Load(), fromDaily.Load(), fromCredits.Load(), limited.Load())
	}
	if st := f.state(t); st.UsedToday != photoLimit || *st.Remaining != 0 || st.Credits != 0 {
		t.Errorf("state: %+v", st)
	}
}

func TestCredits_DailyFirstThenCredits_RefundToBothSources(t *testing.T) {
	f := newCreditsFixture(t, 4)
	ctx := context.Background()

	res, err := f.svc.Consume(ctx, f.user, domain.FeaturePhotoImport, photoLimit-1)
	if err != nil || res.FromDaily != photoLimit-1 || res.FromCredits != 0 || res.Credits != 4 || *res.DailyRemaining != 1 {
		t.Fatalf("free units first: %+v %v", res, err)
	}
	// 1 free + 4 credits = 5 < 6: refused, and nothing at all changes
	_, err = f.svc.Consume(ctx, f.user, domain.FeaturePhotoImport, 6)
	if n, _ := domain.CreditsOf(err); !errors.Is(err, domain.ErrDailyLimit) || n != 4 {
		t.Fatalf("over both: %v", err)
	}
	if st := f.state(t); st.UsedToday != photoLimit-1 || st.Credits != 4 {
		t.Fatalf("a refused consume changed something: %+v", st)
	}
	// split over both sources
	res, err = f.svc.Consume(ctx, f.user, domain.FeaturePhotoImport, 3)
	if err != nil || res.FromDaily != 1 || res.FromCredits != 2 || res.Credits != 2 || *res.DailyRemaining != 0 {
		t.Fatalf("split: %+v %v", res, err)
	}
	if err := f.svc.Refund(ctx, f.user, domain.FeaturePhotoImport, res); err != nil {
		t.Fatal(err)
	}
	if st := f.state(t); st.UsedToday != photoLimit-1 || st.Credits != 4 {
		t.Errorf("refund to both sources: %+v", st)
	}

	// an unlimited feature never touches its balance
	if _, err := f.repo.AddCredits(ctx, f.user, domain.FeatureWordSearch, 2, domain.CreditAdmin, nil, nil, ""); err != nil {
		t.Fatal(err)
	}
	if res, err := f.svc.Consume(ctx, f.user, domain.FeatureWordSearch, 3); err != nil || res.FromCredits != 0 || res.DailyRemaining != nil || res.Credits != 2 {
		t.Errorf("unlimited: %+v %v", res, err)
	}
	if credits, _ := f.repo.Credits(ctx, f.user); credits[domain.FeatureWordSearch] != 2 || credits[domain.FeaturePhotoImport] != 4 {
		t.Errorf("credits after an unlimited consume: %v", credits)
	}
}

func TestCredits_AddCredits_NeverBelowZero_Ledger(t *testing.T) {
	f := newCreditsFixture(t, 0)
	ctx := context.Background()
	admin := addUser(t, f.moveFixture, domain.RoleAdmin, false)

	// a negative grant on a user without a balance row yet: refused, no row left behind
	if _, err := f.repo.AddCredits(ctx, f.user, domain.FeaturePhotoImport, -1, domain.CreditAdmin, nil, &admin, ""); !errors.Is(err, domain.ErrValidation) {
		t.Fatalf("below 0 on a new row: %v", err)
	}
	if n, err := f.repo.AddCredits(ctx, f.user, domain.FeaturePhotoImport, 10, domain.CreditAdmin, nil, &admin, "bonus"); err != nil || n != 10 {
		t.Fatalf("+10: %d %v", n, err)
	}
	if n, err := f.repo.AddCredits(ctx, f.user, domain.FeaturePhotoImport, -10, domain.CreditRefund, nil, &admin, "money back"); err != nil || n != 0 {
		t.Fatalf("-10: %d %v", n, err)
	}
	if _, err := f.repo.AddCredits(ctx, f.user, domain.FeaturePhotoImport, -1, domain.CreditAdmin, nil, &admin, ""); !errors.Is(err, domain.ErrValidation) {
		t.Errorf("below 0: %v", err)
	}
	if _, err := f.repo.AddCredits(ctx, f.user, domain.FeaturePhotoImport, 0, domain.CreditAdmin, nil, &admin, ""); !errors.Is(err, domain.ErrValidation) {
		t.Errorf("0: %v", err)
	}
	if _, err := f.repo.AddCredits(ctx, uuid.New(), domain.FeaturePhotoImport, 5, domain.CreditAdmin, nil, &admin, ""); !errors.Is(err, domain.ErrNotFound) {
		t.Errorf("unknown user: %v", err)
	}
	// the database itself refuses a negative balance
	if _, err := f.pool.Exec(ctx, `UPDATE feature_credits SET balance = -1 WHERE user_id = $1`, f.user); err == nil {
		t.Error("CHECK (balance >= 0) is missing")
	}

	var rows, sum int
	if err := f.pool.QueryRow(ctx, `SELECT count(*), COALESCE(sum(delta), 0) FROM credit_ledger WHERE user_id = $1`, f.user).Scan(&rows, &sum); err != nil {
		t.Fatal(err)
	}
	if rows != 2 || sum != 0 {
		t.Errorf("ledger: %d rows, sum %d; want only the 2 that happened", rows, sum)
	}
}

func TestPurchases_CreateCodeCapListCancel(t *testing.T) {
	f := newMoveFixture(t)
	ctx := context.Background()
	repo := NewPurchaseRepository(f.pool)
	other := addUser(t, f, domain.RoleUser, false)
	pack, _ := domain.PackByID("photo_35")

	p, err := repo.Create(ctx, f.user, pack, 3)
	if err != nil || len(p.Code) != 7 || p.Code[:3] != "YD-" || p.Status != domain.PurchasePending || p.Amount != 35 || p.PriceUZS != 25000 ||
		p.Feature != domain.FeaturePhotoImport || p.UserID != f.user || p.DecidedAt != nil {
		t.Fatalf("create: %+v %v", p, err)
	}
	// a code held by a pending request is skipped: the next one is tried
	free := "YD-0000"
	if p.Code == free {
		free = "YD-0001"
	}
	codes := []string{p.Code, p.Code, free}
	repo.codes = func() string { c := codes[0]; codes = codes[1:]; return c }
	if q, err := repo.Create(ctx, other, pack, 3); err != nil || q.Code != free {
		t.Fatalf("retry on a taken code: %+v %v", q, err)
	}
	repo.codes = randomPurchaseCode

	// at most 3 pending, also when asked in parallel
	var wg sync.WaitGroup
	var created, refused atomic.Int32
	for range 6 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			switch _, err := repo.Create(ctx, f.user, pack, 3); {
			case err == nil:
				created.Add(1)
			case errors.Is(err, domain.ErrTooManyPending):
				refused.Add(1)
			default:
				t.Error(err)
			}
		}()
	}
	wg.Wait()
	if n, _ := repo.CountPending(ctx, f.user); created.Load() != 2 || refused.Load() != 4 || n != 3 {
		t.Fatalf("created %d, refused %d, pending %d", created.Load(), refused.Load(), n)
	}

	mine, err := repo.ListByUser(ctx, f.user, 10)
	if err != nil || len(mine) != 3 || mine[2].ID != p.ID {
		t.Fatalf("mine, newest first: %+v %v", mine, err)
	}
	if !slices.IsSortedFunc(mine, func(a, b domain.PurchaseRequest) int { return b.CreatedAt.Compare(a.CreatedAt) }) {
		t.Errorf("not newest first: %+v", mine)
	}

	// someone else's request cannot be cancelled
	if err := repo.Cancel(ctx, other, p.ID); !errors.Is(err, domain.ErrPurchaseNotFound) || !errors.Is(err, domain.ErrNotFound) {
		t.Errorf("cancel someone else's: %v", err)
	}
	if err := repo.Cancel(ctx, f.user, uuid.New()); !errors.Is(err, domain.ErrPurchaseNotFound) {
		t.Errorf("cancel a missing one: %v", err)
	}
	if err := repo.Cancel(ctx, f.user, p.ID); err != nil {
		t.Fatal(err)
	}
	if err := repo.Cancel(ctx, f.user, p.ID); !errors.Is(err, domain.ErrPurchaseNotFound) {
		t.Errorf("cancel twice: %v", err)
	}
	if n, _ := repo.CountPending(ctx, f.user); n != 2 {
		t.Errorf("pending after cancel: %d", n)
	}
}

func TestPurchases_ApproveAddsCreditsOnce_Reject_AdminIDs(t *testing.T) {
	f := newMoveFixture(t)
	ctx := context.Background()
	repo := NewPurchaseRepository(f.pool)
	features := NewFeatureRepository(f.pool)
	admin := addUser(t, f, domain.RoleAdmin, false)
	banned := addUser(t, f, domain.RoleAdmin, true)
	pack, _ := domain.PackByID("photo_35")
	p, _ := repo.Create(ctx, f.user, pack, 3)
	q, _ := repo.Create(ctx, f.user, pack, 3)

	// approved twice at the same time: one wins, the credits are added once
	var wg sync.WaitGroup
	var approved, decided atomic.Int32
	for range 4 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			switch got, err := repo.Approve(ctx, p.ID, admin); {
			case err == nil:
				approved.Add(1)
				if got.Status != domain.PurchasePaid || got.DecidedBy == nil || *got.DecidedBy != admin || got.DecidedAt == nil || got.UserEmail == "" {
					t.Errorf("approved: %+v", got)
				}
			case errors.Is(err, domain.ErrPurchaseDecided):
				decided.Add(1)
			default:
				t.Error(err)
			}
		}()
	}
	wg.Wait()
	if approved.Load() != 1 || decided.Load() != 3 {
		t.Fatalf("approved %d, already decided %d", approved.Load(), decided.Load())
	}
	if _, err := repo.Approve(ctx, p.ID, admin); !errors.Is(err, domain.ErrPurchaseDecided) {
		t.Errorf("approve again: %v", err)
	}
	if _, err := repo.Reject(ctx, p.ID, admin); !errors.Is(err, domain.ErrPurchaseDecided) {
		t.Errorf("reject a paid one: %v", err)
	}
	credits, _ := features.Credits(ctx, f.user)
	if credits[domain.FeaturePhotoImport] != 35 {
		t.Errorf("credits %d, want 35", credits[domain.FeaturePhotoImport])
	}
	var ledger int
	_ = f.pool.QueryRow(ctx, `SELECT count(*) FROM credit_ledger WHERE purchase_id = $1 AND reason = 'purchase' AND delta = 35 AND created_by = $2`, p.ID, admin).Scan(&ledger)
	if ledger != 1 {
		t.Errorf("ledger rows for the purchase: %d", ledger)
	}

	r, err := repo.Reject(ctx, q.ID, admin)
	if err != nil || r.Status != domain.PurchaseRejected {
		t.Fatalf("reject: %+v %v", r, err)
	}
	if _, err := repo.Approve(ctx, q.ID, admin); !errors.Is(err, domain.ErrPurchaseDecided) {
		t.Errorf("approve a rejected one: %v", err)
	}
	if credits, _ := features.Credits(ctx, f.user); credits[domain.FeaturePhotoImport] != 35 {
		t.Errorf("a rejection adds nothing: %v", credits)
	}
	if _, err := repo.Approve(ctx, uuid.New(), admin); !errors.Is(err, domain.ErrPurchaseNotFound) {
		t.Errorf("approve a missing one: %v", err)
	}

	paid, err := repo.ListByStatus(ctx, domain.PurchasePaid, 200)
	if err != nil || !slices.ContainsFunc(paid, func(x domain.PurchaseRequest) bool { return x.ID == p.ID && x.UserEmail == f.user.String()+"@test" }) {
		t.Errorf("paid listing with the email: %+v %v", paid, err)
	}
	if all, _ := repo.ListByStatus(ctx, "", 200); !slices.ContainsFunc(all, func(x domain.PurchaseRequest) bool { return x.ID == q.ID }) {
		t.Error("all listing misses the rejected one")
	}

	ids, err := repo.AdminIDs(ctx)
	if err != nil || !slices.Contains(ids, admin) || slices.Contains(ids, banned) || slices.Contains(ids, f.user) {
		t.Errorf("admin ids: %v %v", ids, err)
	}
}
