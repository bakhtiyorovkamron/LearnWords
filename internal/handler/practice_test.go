package handler

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"learnwords/internal/domain"
	"learnwords/internal/service"
)

type fakePracticeRepo struct {
	calls   int
	exclude []uuid.UUID
}

func (f *fakePracticeRepo) ListDue(context.Context, uuid.UUID, time.Time, int, *domain.FolderFilter) ([]domain.DueCard, error) {
	return nil, nil
}
func (f *fakePracticeRepo) CountDue(context.Context, uuid.UUID, time.Time, *domain.FolderFilter) (int, error) {
	return 0, nil
}
func (f *fakePracticeRepo) Apply(context.Context, uuid.UUID, uuid.UUID, time.Time, bool,
	func(domain.Progress) domain.Progress) (*domain.Progress, error) {
	return &domain.Progress{}, nil
}
func (f *fakePracticeRepo) PracticeWords(_ context.Context, _ uuid.UUID, _ string, _ int, _ *domain.FolderFilter, exclude []uuid.UUID) ([]domain.DueCard, error) {
	f.calls++
	f.exclude = exclude
	return []domain.DueCard{}, nil
}
func (f *fakePracticeRepo) LogPractice(context.Context, uuid.UUID, uuid.UUID, bool) error { return nil }
func (f *fakePracticeRepo) MarkGoalDay(context.Context, uuid.UUID, time.Time) error       { return nil }

func getPractice(repo *fakePracticeRepo, query string) *httptest.ResponseRecorder {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(func(c *gin.Context) { c.Set(userIDKey, uuid.New()) })
	r.GET("/practice/words", NewPracticeHandler(service.NewReviewService(repo)).Words)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/practice/words?"+query, nil))
	return w
}

func TestPracticeWords_ExcludeIDs(t *testing.T) {
	a, b := uuid.New(), uuid.New()

	repo := &fakePracticeRepo{}
	if w := getPractice(repo, "mode=hard&limit=20&exclude_ids="+a.String()+","+b.String()); w.Code != 200 {
		t.Fatalf("valid: %d %s", w.Code, w.Body)
	}
	if len(repo.exclude) != 2 || repo.exclude[0] != a || repo.exclude[1] != b {
		t.Errorf("exclude passed = %v", repo.exclude)
	}

	repo = &fakePracticeRepo{}
	if w := getPractice(repo, "mode=random"); w.Code != 200 || repo.calls != 1 || len(repo.exclude) != 0 {
		t.Errorf("without exclude_ids: %d, exclude %v", w.Code, repo.exclude)
	}

	max := make([]string, MaxPracticeExclude)
	for i := range max {
		max[i] = uuid.NewString()
	}
	repo = &fakePracticeRepo{}
	if w := getPractice(repo, "exclude_ids="+strings.Join(max, ",")); w.Code != 200 || len(repo.exclude) != MaxPracticeExclude {
		t.Errorf("%d ids: %d", MaxPracticeExclude, w.Code)
	}

	for name, q := range map[string]string{
		"invalid":  "exclude_ids=" + a.String() + ",nope",
		"too many": "exclude_ids=" + strings.Join(append(max, uuid.NewString()), ","),
	} {
		repo = &fakePracticeRepo{}
		if w := getPractice(repo, q); w.Code != http.StatusBadRequest || repo.calls != 0 {
			t.Errorf("%s: %d, calls %d", name, w.Code, repo.calls)
		}
	}
}
