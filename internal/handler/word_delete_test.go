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

type fakeDeleter struct {
	err   error
	calls int
	ids   []uuid.UUID
}

func (f *fakeDeleter) DeleteWords(_ context.Context, _ uuid.UUID, ids []uuid.UUID) (int, error) {
	f.calls++
	f.ids = ids
	if f.err != nil {
		return 0, f.err
	}
	return len(ids), nil
}

func postDelete(d *fakeDeleter, body string) *httptest.ResponseRecorder {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(func(c *gin.Context) { c.Set(userIDKey, uuid.New()) })
	r.POST("/words/delete", NewWordDeleteHandler(d).Delete)
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/words/delete", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)
	return w
}

func TestDeleteHandler(t *testing.T) {
	a, b := uuid.New(), uuid.New()

	d := &fakeDeleter{}
	w := postDelete(d, fmt.Sprintf(`{"word_ids":["%s","%s","%s"]}`, a, b, a))
	var res domain.DeleteResult
	if json.Unmarshal(w.Body.Bytes(), &res); w.Code != 200 || res.Deleted != 2 || len(d.ids) != 2 || d.ids[0] != a || d.ids[1] != b {
		t.Errorf("many: %d %s ids=%v", w.Code, w.Body, d.ids)
	}

	ids := ""
	for i := 0; i <= domain.MaxDeleteWords; i++ {
		ids += fmt.Sprintf(`"%s",`, uuid.New())
	}
	for name, body := range map[string]string{
		"empty":    `{"word_ids":[]}`,
		"too many": `{"word_ids":[` + ids[:len(ids)-1] + `]}`,
		"bad JSON": `{"word_ids":[`,
	} {
		d = &fakeDeleter{}
		if w := postDelete(d, body); w.Code != http.StatusBadRequest || d.calls != 0 {
			t.Errorf("%s: %d calls=%d", name, w.Code, d.calls)
		}
	}

	d = &fakeDeleter{err: fmt.Errorf("db down")}
	if w := postDelete(d, fmt.Sprintf(`{"word_ids":["%s"]}`, a)); w.Code != http.StatusInternalServerError {
		t.Errorf("store error: %d", w.Code)
	}
}
