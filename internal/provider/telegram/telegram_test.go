package telegram

import (
	"context"
	"encoding/json"
	"errors"
	"learnwords/internal/domain"
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
	if err := New(token).WithBaseURL(srv.URL).SendMessage(context.Background(), 42, "hi", nil); err != nil {
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
	err = New(token).WithBaseURL("http://127.0.0.1:1").SendMessage(context.Background(), 1, "x", nil)
	if err == nil || strings.Contains(err.Error(), token) || !strings.Contains(err.Error(), "<redacted>") {
		t.Errorf("err = %v", err)
	}
}

func TestSendMessage_ButtonAndPlainText(t *testing.T) {
	var body map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewDecoder(r.Body).Decode(&body)
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer srv.Close()
	c := New(token).WithBaseURL(srv.URL)
	btn := &domain.TelegramButton{Text: "Open", URL: "https://yodla.fun"}
	if err := c.SendMessage(context.Background(), 1, "a <b>b</b>", btn); err != nil {
		t.Fatal(err)
	}
	if _, ok := body["parse_mode"]; ok {
		t.Error("parse_mode is set: messages are plain text")
	}
	kb := body["reply_markup"].(map[string]any)["inline_keyboard"].([]any)[0].([]any)[0].(map[string]any)
	if kb["text"] != "Open" || kb["url"] != "https://yodla.fun" {
		t.Errorf("button %v", kb)
	}
	body = nil
	if err := c.SendMessage(context.Background(), 1, "plain", nil); err != nil {
		t.Fatal(err)
	}
	if _, ok := body["reply_markup"]; ok {
		t.Error("a message without a button has reply_markup")
	}
}

func TestSendMessage_TypedErrors(t *testing.T) {
	for _, tc := range []struct {
		status int
		body   string
		check  func(error) bool
	}{
		{403, `{"ok":false,"description":"Forbidden: bot was blocked by the user"}`, func(e error) bool { return errors.Is(e, ErrBotBlocked) }},
		{429, `{"ok":false,"description":"Too Many Requests","parameters":{"retry_after":7}}`, func(e error) bool {
			var r *RetryAfterError
			return errors.As(e, &r) && r.Seconds == 7
		}},
		{500, `{"ok":false,"description":"boom"}`, func(e error) bool {
			var r *RetryAfterError
			return !errors.Is(e, ErrBotBlocked) && !errors.As(e, &r)
		}},
	} {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(tc.status)
			_, _ = w.Write([]byte(tc.body))
		}))
		err := New(token).WithBaseURL(srv.URL).SendMessage(context.Background(), 1, "x", nil)
		srv.Close()
		if err == nil || !tc.check(err) || strings.Contains(err.Error(), token) {
			t.Errorf("%d: err = %v", tc.status, err)
		}
	}
}
