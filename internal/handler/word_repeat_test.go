package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"learnwords/internal/domain"
)

type fakeRepeater struct {
	err    error
	calls  int
	word   uuid.UUID
	marked bool
}

func (f *fakeRepeater) SetRepeat(_ context.Context, _, word uuid.UUID, marked bool) (bool, error) {
	f.calls++
	f.word, f.marked = word, marked
	return marked, f.err
}

func postRepeat(f *fakeRepeater, body string) *httptest.ResponseRecorder {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(func(c *gin.Context) { c.Set(userIDKey, uuid.New()) })
	r.POST("/words/repeat", NewWordRepeatHandler(f).Repeat)
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/words/repeat", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)
	return w
}

func TestWordRepeatHandler(t *testing.T) {
	id := uuid.New()
	for _, on := range []bool{true, false} {
		f := &fakeRepeater{}
		w := postRepeat(f, fmt.Sprintf(`{"word_id":"%s","marked":%v}`, id, on))
		var res struct{ Marked bool }
		if json.Unmarshal(w.Body.Bytes(), &res); w.Code != 200 || res.Marked != on || f.word != id || f.marked != on {
			t.Errorf("marked=%v: %d %s", on, w.Code, w.Body)
		}
	}

	if w := postRepeat(&fakeRepeater{err: domain.ErrNotFound}, fmt.Sprintf(`{"word_id":"%s","marked":true}`, id)); w.Code != http.StatusNotFound {
		t.Errorf("foreign word: %d", w.Code)
	}

	for name, body := range map[string]string{
		"no marked": fmt.Sprintf(`{"word_id":"%s"}`, id),
		"no word":   `{"marked":true}`,
		"bad id":    `{"word_id":"x","marked":true}`,
		"bad json":  `{`,
		"not bool":  fmt.Sprintf(`{"word_id":"%s","marked":"yes"}`, id),
	} {
		f := &fakeRepeater{}
		if w := postRepeat(f, body); w.Code != http.StatusBadRequest || f.calls != 0 {
			t.Errorf("%s: %d, calls %d", name, w.Code, f.calls)
		}
	}
}

type fakeCollection struct {
	calls int
	f     domain.CollectionFilter
}

func (s *fakeCollection) ListCollection(_ context.Context, _ uuid.UUID, f domain.CollectionFilter) ([]domain.CollectionCard, int, error) {
	s.calls++
	s.f = f
	return nil, 0, nil
}
func (s *fakeCollection) ListCollectionIDs(_ context.Context, _ uuid.UUID, f domain.CollectionFilter) ([]uuid.UUID, int, error) {
	s.calls++
	s.f = f
	return nil, 0, nil
}

func getCollection(s *fakeCollection, query string) *httptest.ResponseRecorder {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(func(c *gin.Context) { c.Set(userIDKey, uuid.New()) })
	r.GET("/collection", NewCollectionHandler(s).List)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/collection?"+query, nil))
	return w
}

func TestCollection_SortRepeatAndMarksBefore(t *testing.T) {
	s := &fakeCollection{}
	if w := getCollection(s, "sort=repeat&marks_before=2026-11-19T10:00:00Z"); w.Code != 200 || s.f.Sort != "repeat" ||
		s.f.MarksBefore.UTC().Format("2006-01-02T15:04:05Z") != "2026-11-19T10:00:00Z" {
		t.Errorf("valid: %d %+v", w.Code, s.f)
	}
	s = &fakeCollection{}
	if w := getCollection(s, "sort=repeat"); w.Code != 200 || s.f.MarksBefore.IsZero() {
		t.Errorf("default marks_before: %d %v", w.Code, s.f.MarksBefore)
	}
	for _, q := range []string{"sort=repeat&marks_before=yesterday", "sort=repeat&marks_before=2026-11-19", "sort=random"} {
		s = &fakeCollection{}
		if w := getCollection(s, q); w.Code != http.StatusBadRequest || s.calls != 0 {
			t.Errorf("%s: %d", q, w.Code)
		}
	}
}
