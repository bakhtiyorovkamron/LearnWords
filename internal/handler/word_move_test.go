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

type fakeMover struct {
	err   error
	calls int
	ids   []uuid.UUID
	to    *uuid.UUID
}

func (f *fakeMover) MoveWords(_ context.Context, _ uuid.UUID, ids []uuid.UUID, folder *uuid.UUID) ([]domain.WordFolder, error) {
	f.calls++
	f.ids, f.to = ids, folder
	if f.err != nil {
		return nil, f.err
	}
	out := make([]domain.WordFolder, len(ids))
	for i, id := range ids {
		out[i] = domain.WordFolder{WordID: id}
	}
	return out, nil
}

func postMove(m *fakeMover, body string) *httptest.ResponseRecorder {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(func(c *gin.Context) { c.Set(userIDKey, uuid.New()) })
	r.POST("/words/move", NewWordMoveHandler(m).Move)
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/words/move", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)
	return w
}

func TestMoveHandler(t *testing.T) {
	a, b, f := uuid.New(), uuid.New(), uuid.New()

	m := &fakeMover{}
	w := postMove(m, fmt.Sprintf(`{"word_ids":["%s","%s","%s"],"folder_id":"%s"}`, a, b, a, f))
	var res domain.MoveResult
	if json.Unmarshal(w.Body.Bytes(), &res); w.Code != 200 || res.Moved != 2 || len(res.Previous) != 2 || m.to == nil || *m.to != f {
		t.Errorf("many: %d %s", w.Code, w.Body)
	}

	m = &fakeMover{}
	if w := postMove(m, fmt.Sprintf(`{"word_ids":["%s"],"folder_id":null}`, a)); w.Code != 200 || m.to != nil || m.calls != 1 {
		t.Errorf("no folder: %d %s", w.Code, w.Body)
	}

	m = &fakeMover{err: domain.ErrNotFound}
	if w := postMove(m, fmt.Sprintf(`{"word_ids":["%s"],"folder_id":"%s"}`, a, f)); w.Code != http.StatusNotFound {
		t.Errorf("foreign: %d", w.Code)
	}

	ids := ""
	for i := 0; i <= domain.MaxMoveWords; i++ {
		ids += fmt.Sprintf(`"%s",`, uuid.New())
	}
	for name, body := range map[string]string{
		"empty":    `{"word_ids":[],"folder_id":null}`,
		"too many": `{"word_ids":[` + ids[:len(ids)-1] + `],"folder_id":null}`,
		"bad id":   `{"word_ids":["x"],"folder_id":null}`,
		"bad":      `{"word_ids":["` + a.String() + `"],"folder_id":"nope"}`,
	} {
		m = &fakeMover{}
		if w := postMove(m, body); w.Code != http.StatusBadRequest || m.calls != 0 {
			t.Errorf("%s: %d calls=%d", name, w.Code, m.calls)
		}
	}
}
