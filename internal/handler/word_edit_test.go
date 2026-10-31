package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"learnwords/internal/domain"
)

type fakeUpdater struct{ got domain.WordCardUpdate }

func (f *fakeUpdater) UpdateContent(_ context.Context, _, id uuid.UUID, u domain.WordCardUpdate) (*domain.CollectionCard, error) {
	f.got = u
	c := &domain.CollectionCard{BoxLevel: 2}
	c.ID, c.Word, c.Translation = id, "Süden", "юг"
	if u.SetFolder {
		c.FolderID = u.Folder
	}
	return c, nil
}

func patchWord(f *fakeUpdater, body string) *httptest.ResponseRecorder {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(func(c *gin.Context) { c.Set(userIDKey, uuid.New()) })
	r.PATCH("/words/:id", NewWordEditHandler(f).Update)
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPatch, "/words/"+uuid.NewString(), bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)
	return w
}

// The edit form of the bug report: empty example texts + a folder.
func TestWordEdit_EmptyExampleAndFolder(t *testing.T) {
	f := &fakeUpdater{}
	folder := uuid.New()
	w := patchWord(f, `{"word":"Süden","translation":"юг","transcription":"[ˈzyːdn̩]","example_sentence":"","example_translation":"","folder_id":"`+folder.String()+`"}`)
	if w.Code != http.StatusOK {
		t.Fatalf("status %d: %s", w.Code, w.Body)
	}
	var out map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	for _, k := range []string{"id", "word", "translation", "folder_id", "box_level", "is_learned", "next_review_at", "reviewed_today"} {
		if _, ok := out[k]; !ok {
			t.Errorf("response lacks %q: %s", k, w.Body)
		}
	}
	if out["folder_id"] != folder.String() {
		t.Errorf("folder_id %v", out["folder_id"])
	}
	if f.got.ExampleSentence == nil || *f.got.ExampleSentence != "" {
		t.Errorf("empty example must reach the store as an empty string: %+v", f.got.ExampleSentence)
	}
}

// A card can never be saved without a translation: the training question would have no prompt.
func TestWordEdit_EmptyTranslationIsRejected(t *testing.T) {
	for _, body := range []string{`{"translation":""}`, `{"translation":"   "}`, `{"word":"Süden","translation":"\n"}`} {
		f := &fakeUpdater{}
		w := patchWord(f, body)
		if w.Code != http.StatusBadRequest {
			t.Errorf("%s → %d, want 400", body, w.Code)
		}
		if f.got.Translation != nil || f.got.Word != nil {
			t.Errorf("%s reached the store: %+v", body, f.got)
		}
	}
	// Leaving the translation out (an edit of other fields) is fine.
	if w := patchWord(&fakeUpdater{}, `{"transcription":"[x]"}`); w.Code != http.StatusOK {
		t.Errorf("edit without a translation field: %d", w.Code)
	}
}
