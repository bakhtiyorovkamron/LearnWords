package handler

import (
	"bytes"
	"context"
	"mime/multipart"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"learnwords/internal/domain"
	"learnwords/internal/service"
)

var png = append([]byte("\x89PNG\r\n\x1a\n"), make([]byte, 64)...)

// okReader answers with one word; a non-empty status makes it reject the photo instead.
type okReader struct{ status string }

func (r okReader) ExtractPhotoWords(context.Context, []byte, string) (domain.PhotoReading, error) {
	art := "der"
	return domain.PhotoReading{Status: r.status, Words: []domain.PhotoWord{{Word: "Hund", Article: &art, WordType: "noun", Translation: "собака"}}}, nil
}

type noWords struct{}

func (noWords) HasWord(context.Context, uuid.UUID, ...string) (bool, error) { return false, nil }

func photoEnv(t *testing.T) (*gin.Engine, *service.FeatureService, uuid.UUID) {
	gin.SetMode(gin.TestMode)
	user := uuid.New()
	feats := service.NewFeatureService(&memFeatures{ov: map[string]domain.FeatureOverride{}})
	r := gin.New()
	r.Use(func(c *gin.Context) { c.Set(userIDKey, user) }, NativeLang())
	r.POST("/photo-import", NewPhotoHandler(service.NewPhotoImportService(okReader{}, noWords{}, feats)).Import)
	return r, feats, user
}

func upload(r *gin.Engine, field string, data []byte) *httptest.ResponseRecorder {
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	if field != "" {
		fw, _ := mw.CreateFormFile(field, "page.png")
		fw.Write(data) //nolint:errcheck
	}
	mw.Close()
	w := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/photo-import", &body)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	r.ServeHTTP(w, req)
	return w
}

func TestPhotoImport_Success(t *testing.T) {
	r, _, _ := photoEnv(t)
	w := upload(r, "image", png)
	m := decode(t, w)
	words, _ := m["words"].([]any)
	if w.Code != 200 || len(words) != 1 || m["remaining"] != float64(defaultPhotoLimit-1) {
		t.Fatalf("%d %s", w.Code, w.Body)
	}
	if first := words[0].(map[string]any); first["full_word"] != "der Hund" || first["already_added"] != false {
		t.Errorf("%v", first)
	}
}

func TestPhotoImport_Errors(t *testing.T) {
	r, feats, user := photoEnv(t)
	for name, c := range map[string]struct {
		field string
		data  []byte
		want  int
	}{
		"no file":      {"", nil, 400},
		"wrong field":  {"file", png, 400},
		"not an image": {"image", []byte("just text, not a picture"), 400},
		"over 5 MB":    {"image", append(append([]byte{}, png...), make([]byte, service.MaxPhotoBytes)...), 413},
		"way too big":  {"image", make([]byte, service.MaxPhotoBytes+2<<20), 413},
	} {
		if w := upload(r, c.field, c.data); w.Code != c.want {
			t.Errorf("%s: %d, want %d (%s)", name, w.Code, c.want, w.Body)
		}
	}

	// the daily limit: that many photos, the next one is a 429 with the limit
	for i := range defaultPhotoLimit {
		if w := upload(r, "image", png); w.Code != 200 {
			t.Fatalf("photo %d: %d", i+1, w.Code)
		}
	}
	w := upload(r, "image", png)
	if m := decode(t, w); w.Code != 429 || m["code"] != "daily_limit" || m["limit"] != float64(defaultPhotoLimit) {
		t.Errorf("limit: %d %s", w.Code, w.Body)
	}

	// switched off
	_ = feats.Set(context.Background(), user, domain.FeaturePhotoImport, false, nil)
	w = upload(r, "image", png)
	if m := decode(t, w); w.Code != 403 || m["code"] != "feature_disabled" {
		t.Errorf("disabled: %d %s", w.Code, w.Body)
	}
}

func TestPhotoImport_RejectedPhotoIs422_AndNotCharged(t *testing.T) {
	for status, code := range map[string]string{
		domain.PhotoNotDocument: "photo_not_document",
		domain.PhotoUnreadable:  "photo_unreadable",
	} {
		gin.SetMode(gin.TestMode)
		user := uuid.New()
		feats := service.NewFeatureService(&memFeatures{ov: map[string]domain.FeatureOverride{}})
		r := gin.New()
		r.Use(func(c *gin.Context) { c.Set(userIDKey, user) }, NativeLang())
		r.POST("/photo-import", NewPhotoHandler(service.NewPhotoImportService(okReader{status: status}, noWords{}, feats)).Import)

		for range defaultPhotoLimit + 2 { // more than the daily limit: rejected photos never use it up
			w := upload(r, "image", png)
			if m := decode(t, w); w.Code != 422 || m["code"] != code {
				t.Fatalf("%s: %d %s", status, w.Code, w.Body)
			}
		}
		st, _ := feats.State(context.Background(), user, domain.FeaturePhotoImport)
		if st.UsedToday != 0 || *st.Remaining != defaultPhotoLimit {
			t.Errorf("%s: %+v", status, st)
		}
	}
}
