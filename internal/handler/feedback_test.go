package handler

import (
	"context"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"learnwords/internal/domain"
)

// memFeedback mimics the repository: the first answer wins.
type memFeedback struct {
	mu   sync.Mutex
	rows map[uuid.UUID]domain.FeedbackItem
	dism map[uuid.UUID]bool
}

func newMemFeedback() *memFeedback {
	return &memFeedback{rows: map[uuid.UUID]domain.FeedbackItem{}, dism: map[uuid.UUID]bool{}}
}
func (m *memFeedback) Answered(_ context.Context, id uuid.UUID) (bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	_, rated := m.rows[id]
	return rated || m.dism[id], nil
}
func (m *memFeedback) Submit(_ context.Context, id uuid.UUID, rating int, comment string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, rated := m.rows[id]; !rated && !m.dism[id] {
		m.rows[id] = domain.FeedbackItem{Rating: rating, Comment: comment}
	}
	return nil
}
func (m *memFeedback) Dismiss(_ context.Context, id uuid.UUID) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, rated := m.rows[id]; !rated {
		m.dism[id] = true
	}
	return nil
}
func (m *memFeedback) Summary(context.Context) (domain.FeedbackSummary, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	s := domain.FeedbackSummary{Items: []domain.FeedbackItem{}}
	sum := 0
	for _, it := range m.rows { // dismissed rows are not in m.rows
		s.Items = append(s.Items, it)
		sum += it.Rating
	}
	s.Count = len(s.Items)
	if s.Count > 0 {
		s.Average = float64(sum) / float64(s.Count)
	}
	return s, nil
}

// ageUsers makes GetByID return a user created `age` ago.
type ageUsers struct{ age time.Duration }

func (a ageUsers) GetByID(_ context.Context, id uuid.UUID) (*domain.User, error) {
	return &domain.User{ID: id, Email: "a@b", Role: domain.RoleUser, LearningLanguage: "de", CreatedAt: time.Now().Add(-a.age)}, nil
}

type feedbackEnv struct {
	r  *gin.Engine
	fb *memFeedback
}

func newFeedbackEnv(age time.Duration) feedbackEnv {
	gin.SetMode(gin.TestMode)
	user := uuid.New()
	fb := newMemFeedback()
	feats := newFeatureEnv().feats
	admin := NewAdminHandler(nil, ageUsers{age}, feats, fb)
	h := NewFeedbackHandler(fb)
	r := gin.New()
	r.Use(func(c *gin.Context) { c.Set(userIDKey, user) })
	r.GET("/me", admin.Me)
	r.GET("/admin/feedback", admin.Feedback)
	r.POST("/feedback", h.Submit)
	r.POST("/feedback/dismiss", h.Dismiss)
	return feedbackEnv{r, fb}
}

func (e feedbackEnv) ask(t *testing.T) bool {
	t.Helper()
	w := httptest.NewRecorder()
	e.r.ServeHTTP(w, httptest.NewRequest("GET", "/me", nil))
	v, ok := decode(t, w)["ask_feedback"].(bool)
	if !ok {
		t.Fatalf("no ask_feedback in %s", w.Body)
	}
	return v
}

func TestAskFeedback_OnlyFromTheThirdDay(t *testing.T) {
	if newFeedbackEnv(24 * time.Hour).ask(t) {
		t.Error("a 1-day-old user must not be asked")
	}
	if !newFeedbackEnv(72 * time.Hour).ask(t) {
		t.Error("a 3-day-old user must be asked")
	}
}

func TestAskFeedback_NeverAgainAfterSubmitOrDismiss(t *testing.T) {
	e := newFeedbackEnv(72 * time.Hour)
	if w := sendJSON(e.r, "POST", "/feedback", `{"rating":5,"comment":"  great  "}`); w.Code != 204 {
		t.Fatalf("submit: %d %s", w.Code, w.Body)
	}
	if e.ask(t) {
		t.Error("asked again after a rating")
	}
	if got := e.fb.rows; len(got) != 1 {
		t.Fatalf("rows %v", got)
	}
	for _, it := range e.fb.rows {
		if it.Comment != "great" {
			t.Errorf("comment must be trimmed: %q", it.Comment)
		}
	}

	d := newFeedbackEnv(72 * time.Hour)
	if w := sendJSON(d.r, "POST", "/feedback/dismiss", ``); w.Code != 204 {
		t.Fatalf("dismiss: %d", w.Code)
	}
	if d.ask(t) {
		t.Error("asked again after dismissing")
	}
}

func TestFeedback_FirstAnswerWins(t *testing.T) {
	e := newFeedbackEnv(72 * time.Hour)
	sendJSON(e.r, "POST", "/feedback", `{"rating":2,"comment":"first"}`)
	if w := sendJSON(e.r, "POST", "/feedback", `{"rating":5,"comment":"second"}`); w.Code != 204 {
		t.Fatal(w.Code)
	}
	sendJSON(e.r, "POST", "/feedback/dismiss", ``)
	for _, it := range e.fb.rows {
		if it.Rating != 2 || it.Comment != "first" {
			t.Errorf("overwritten: %+v", it)
		}
	}
}

func TestFeedback_Validation(t *testing.T) {
	e := newFeedbackEnv(72 * time.Hour)
	for name, c := range map[string]struct {
		body string
		want int
	}{
		"rating 0":         {`{"rating":0}`, 400},
		"rating 6":         {`{"rating":6}`, 400},
		"no rating":        {`{"comment":"x"}`, 400},
		"bad json":         {`{`, 400},
		"comment 1001":     {`{"rating":3,"comment":"` + strings.Repeat("я", 1001) + `"}`, 400},
		"comment 1000":     {`{"rating":3,"comment":"` + strings.Repeat("я", 1000) + `"}`, 204},
		"body over 8 KB":   {`{"rating":3,"comment":"` + strings.Repeat("a", 9<<10) + `"}`, 413},
		"no comment is ok": {`{"rating":1}`, 204},
	} {
		e := e
		if name == "comment 1000" || name == "no comment is ok" {
			e = newFeedbackEnv(72 * time.Hour)
		}
		if w := sendJSON(e.r, "POST", "/feedback", c.body); w.Code != c.want {
			t.Errorf("%s: %d, want %d (%s)", name, w.Code, c.want, w.Body)
		}
	}
	if len(e.fb.rows) != 0 {
		t.Errorf("invalid requests must store nothing: %v", e.fb.rows)
	}
}

func TestAdminFeedback_Shape(t *testing.T) {
	e := newFeedbackEnv(72 * time.Hour)
	w := httptest.NewRecorder()
	e.r.ServeHTTP(w, httptest.NewRequest("GET", "/admin/feedback", nil))
	m := decode(t, w)
	if w.Code != 200 || m["count"] != float64(0) || m["average"] != float64(0) {
		t.Errorf("%d %s", w.Code, w.Body)
	}
	if items, ok := m["items"].([]any); !ok || len(items) != 0 {
		t.Errorf("items must be an empty list: %v", m["items"])
	}
}
