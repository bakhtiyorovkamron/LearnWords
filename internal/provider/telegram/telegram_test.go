package telegram

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

const token = "123456:SECRET-token"

func TestSendMessage(t *testing.T) {
	var path string
	var body map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path = r.URL.Path
		_ = json.NewDecoder(r.Body).Decode(&body)
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer srv.Close()
	if err := New(token).WithBaseURL(srv.URL).SendMessage(context.Background(), 42, "hi"); err != nil {
		t.Fatal(err)
	}
	if path != "/bot"+token+"/sendMessage" || body["chat_id"] != float64(42) || body["text"] != "hi" {
		t.Errorf("path=%s body=%v", path, body)
	}
}

func TestErrorsNeverContainTheToken(t *testing.T) {
	// A refused API call and an unreachable server (the URL with the token is in net/http's error).
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"ok":false,"description":"Unauthorized"}`))
	}))
	defer srv.Close()
	err := New(token).WithBaseURL(srv.URL).SetWebhook(context.Background(), "https://x/api/telegram/webhook", "s")
	if err == nil || strings.Contains(err.Error(), token) {
		t.Errorf("err = %v", err)
	}
	err = New(token).WithBaseURL("http://127.0.0.1:1").SendMessage(context.Background(), 1, "x")
	if err == nil || strings.Contains(err.Error(), token) || !strings.Contains(err.Error(), "<redacted>") {
		t.Errorf("err = %v", err)
	}
}
