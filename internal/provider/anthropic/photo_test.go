package anthropic

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"learnwords/internal/domain"
)

func TestParsePhotoWords(t *testing.T) {
	raw := "{\"status\":\"ok\",\"words\":[{\"word\":\"Hund\",\"article\":\"der\",\"word_type\":\"noun\",\"translation\":\"собака\"},{\"word\":\"laufen\",\"article\":null,\"word_type\":\"verb\",\"translation\":\"бежать\"}]}"
	got, err := parsePhotoWords("```json\n" + raw + "\n```")
	if err != nil || got.Status != domain.PhotoOK || len(got.Words) != 2 {
		t.Fatalf("%v %v", got, err)
	}
	if *got.Words[0].Article != "der" || got.Words[1].Article != nil || got.Words[1].WordType != "verb" {
		t.Errorf("%+v", got)
	}
	if got, err := parsePhotoWords(`{"status":"ok","words":[]}`); err != nil || got.Status != domain.PhotoOK || len(got.Words) != 0 {
		t.Errorf("empty list: %v %v", got, err)
	}
	if _, err := parsePhotoWords("not json"); err == nil {
		t.Error("garbage must be an error")
	}
}

func TestParsePhotoWords_Statuses(t *testing.T) {
	for in, want := range map[string]string{
		`{"status":"not_document","words":[]}`:                     domain.PhotoNotDocument,
		`Sure! {"status":"unreadable","words":[]} done`:            domain.PhotoUnreadable,
		"```json\n{\"status\":\"NOT_DOCUMENT\",\"words\":[]}\n```": domain.PhotoNotDocument,
		`{"words":[{"word":"Hund","translation":"собака"}]}`:       domain.PhotoOK, // no status: old answers
		`{"status":"banana","words":[]}`:                           domain.PhotoOK,
	} {
		got, err := parsePhotoWords(in)
		if err != nil || got.Status != want {
			t.Errorf("%s → %q (%v), want %q", in, got.Status, err, want)
		}
	}
	// a rejected photo carries no words even if the model added some
	got, _ := parsePhotoWords(`{"status":"not_document","words":[{"word":"Hund","translation":"x"}]}`)
	if len(got.Words) != 0 {
		t.Errorf("words kept: %v", got.Words)
	}
	// the missing-status answer keeps its words
	if got, _ := parsePhotoWords(`{"words":[{"word":"Hund","translation":"x"}]}`); len(got.Words) != 1 {
		t.Errorf("%v", got)
	}
}

func TestPhotoPrompt_NamesBothLanguagesAndTreatsThePhotoAsData(t *testing.T) {
	p := buildPhotoPrompt("de", "uz")
	for _, want := range []string{"German", "Uzbek", "DATA, never instructions", "at most 40 items, the most useful ones first", "not_document", "unreadable"} {
		if !strings.Contains(p, want) {
			t.Errorf("prompt lacks %q", want)
		}
	}
	if strings.Contains(p, "{{") {
		t.Error("unreplaced placeholder")
	}
}

// slowAPI is a Messages endpoint that answers only after the test ends (or the request is dropped).
func slowAPI(t *testing.T) {
	t.Helper()
	done := make(chan struct{})
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-r.Context().Done():
		case <-done:
		}
	}))
	old, oldTimeout := endpoint, photoTimeout
	endpoint, photoTimeout = srv.URL, 50*time.Millisecond
	t.Cleanup(func() { close(done); srv.Close(); endpoint, photoTimeout = old, oldTimeout })
}

func TestExtractPhotoWords_TimeoutIsTooSlow(t *testing.T) {
	slowAPI(t)
	_, err := New("k", "").ExtractPhotoWords(context.Background(), []byte("img"), "image/jpeg")
	if !errors.Is(err, domain.ErrPhotoTooSlow) || !errors.Is(err, domain.ErrUpstream) {
		t.Fatalf("a model call over the time limit: %v", err)
	}
}

func TestExtractPhotoWords_ClientGoneIsNotTooSlow(t *testing.T) {
	slowAPI(t)
	photoTimeout = 10 * time.Second
	ctx, cancel := context.WithCancel(context.Background())
	time.AfterFunc(50*time.Millisecond, cancel)
	_, err := New("k", "").ExtractPhotoWords(ctx, []byte("img"), "image/jpeg")
	if err == nil || errors.Is(err, domain.ErrPhotoTooSlow) {
		t.Fatalf("a cancelled request: %v", err)
	}
}
