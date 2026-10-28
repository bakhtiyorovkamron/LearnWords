package postgres

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"

	"learnwords/internal/domain"
	"learnwords/internal/service"
)

func TestFeatures_ParallelConsumeNeverExceedsLimit(t *testing.T) {
	f := newMoveFixture(t)
	svc := service.NewFeatureService(NewFeatureRepository(f.pool))
	ctx := context.Background()

	var ok, limited atomic.Int32
	var wg sync.WaitGroup
	for range 10 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			switch _, err := svc.Consume(ctx, f.user, domain.FeaturePhotoImport, 1); {
			case err == nil:
				ok.Add(1)
			case errors.Is(err, domain.ErrDailyLimit):
				limited.Add(1)
			default:
				t.Error(err)
			}
		}()
	}
	wg.Wait()
	if ok.Load() != 4 || limited.Load() != 6 {
		t.Fatalf("succeeded %d, limited %d; want 4 and 6", ok.Load(), limited.Load())
	}
	if st, _ := svc.State(ctx, f.user, domain.FeaturePhotoImport); st.UsedToday != 4 || *st.Remaining != 0 {
		t.Errorf("state: %+v", st)
	}
}

func TestFeatures_Postgres_FirstInsertChecksLimit_ResetRefundSet(t *testing.T) {
	f := newMoveFixture(t)
	ctx := context.Background()
	now := time.Date(2026, 10, 29, 10, 0, 0, 0, time.UTC)
	svc := service.NewFeatureService(NewFeatureRepository(f.pool), service.WithFeatureClock(func() time.Time { return now }))

	// the very first insert may not exceed the limit either
	if _, err := svc.Consume(ctx, f.user, domain.FeaturePhotoImport, 5); !errors.Is(err, domain.ErrDailyLimit) {
		t.Fatalf("5 > limit 4 on a fresh day: %v", err)
	}
	if st, _ := svc.State(ctx, f.user, domain.FeaturePhotoImport); st.UsedToday != 0 {
		t.Errorf("nothing may be charged: %+v", st)
	}
	if _, err := svc.Consume(ctx, f.user, domain.FeaturePhotoImport, 4); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Consume(ctx, f.user, domain.FeaturePhotoImport, 1); !errors.Is(err, domain.ErrDailyLimit) {
		t.Fatalf("over: %v", err)
	}

	// refund, floor at 0
	_ = svc.Refund(ctx, f.user, domain.FeaturePhotoImport, 1)
	if st, _ := svc.State(ctx, f.user, domain.FeaturePhotoImport); st.UsedToday != 3 {
		t.Errorf("after refund: %+v", st)
	}
	_ = svc.Refund(ctx, f.user, domain.FeaturePhotoImport, 99)
	if st, _ := svc.State(ctx, f.user, domain.FeaturePhotoImport); st.UsedToday != 0 {
		t.Errorf("refund floor: %+v", st)
	}

	// resets on the next Tashkent day: 19:30 UTC is already the next day there
	_, _ = svc.Consume(ctx, f.user, domain.FeaturePhotoImport, 4)
	now = time.Date(2026, 10, 29, 19, 30, 0, 0, time.UTC)
	if rem, err := svc.Consume(ctx, f.user, domain.FeaturePhotoImport, 1); err != nil || *rem != 3 {
		t.Errorf("next day: %v %v", rem, err)
	}

	// override upsert, and an unknown user
	if err := svc.Set(ctx, f.user, domain.FeaturePhotoImport, false, nil); err != nil {
		t.Fatal(err)
	}
	if err := svc.Require(ctx, f.user, domain.FeaturePhotoImport); !errors.Is(err, domain.ErrFeatureDisabled) {
		t.Errorf("disabled: %v", err)
	}
	if err := svc.Set(ctx, uuid.New(), domain.FeaturePhotoImport, true, nil); !errors.Is(err, domain.ErrNotFound) {
		t.Errorf("unknown user: %v", err)
	}
}
