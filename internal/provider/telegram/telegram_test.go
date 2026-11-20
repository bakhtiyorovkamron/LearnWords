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

// recordCalls serves {"ok":true} and records each call's method and body.
func recordCalls(t *testing.T) (*Client, *[]string, *[]map[string]any) {
	t.Helper()
	var methods []string
	var bodies []map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		methods = append(methods, strings.TrimPrefix(r.URL.Path, "/bot"+token+"/"))
		bodies = append(bodies, body)
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	t.Cleanup(srv.Close)
	return New(token).WithBaseURL(srv.URL), &methods, &bodies
}

func TestSendMessageButtons_CallbackButtons(t *testing.T) {
	c, methods, bodies := recordCalls(t)
	rows := [][]InlineButton{{{Text: "✅ Да, это я", CallbackData: "lg:y:login_x"}, {Text: "Нет", CallbackData: "lg:n:login_x"}}}
	if err := c.SendMessageButtons(context.Background(), 7, "Вход в yodla", rows); err != nil {
		t.Fatal(err)
	}
	b := (*bodies)[0]
	if (*methods)[0] != "sendMessage" || b["chat_id"] != float64(7) || b["text"] != "Вход в yodla" {
		t.Errorf("%s %v", (*methods)[0], b)
	}
	if _, ok := b["parse_mode"]; ok {
		t.Error("parse_mode is set: messages are plain text")
	}
	row := b["reply_markup"].(map[string]any)["inline_keyboard"].([]any)[0].([]any)
	yes, no := row[0].(map[string]any), row[1].(map[string]any)
	if yes["text"] != "✅ Да, это я" || yes["callback_data"] != "lg:y:login_x" || no["callback_data"] != "lg:n:login_x" {
		t.Errorf("buttons %v", row)
	}
	if _, ok := yes["url"]; ok {
		t.Error("a callback button has a url")
	}
}

func TestEditMessageTextAndAnswerCallbackQuery(t *testing.T) {
	c, methods, bodies := recordCalls(t)
	if err := c.EditMessageText(context.Background(), 7, 55, "Вход отменён."); err != nil {
		t.Fatal(err)
	}
	if err := c.AnswerCallbackQuery(context.Background(), "cb-1"); err != nil {
		t.Fatal(err)
	}
	if (*methods)[0] != "editMessageText" || (*bodies)[0]["chat_id"] != float64(7) || (*bodies)[0]["message_id"] != float64(55) ||
		(*bodies)[0]["text"] != "Вход отменён." {
		t.Errorf("%s %v", (*methods)[0], (*bodies)[0])
	}
	if _, ok := (*bodies)[0]["reply_markup"]; ok {
		t.Error("the edit keeps buttons: it must remove them")
	}
	if (*methods)[1] != "answerCallbackQuery" || (*bodies)[1]["callback_query_id"] != "cb-1" {
		t.Errorf("%s %v", (*methods)[1], (*bodies)[1])
	}
}

func TestSetWebhook_AsksForMessagesAndButtonPresses(t *testing.T) {
	c, methods, bodies := recordCalls(t)
	if err := c.SetWebhook(context.Background(), "https://yodla.fun/api/telegram/webhook", "s"); err != nil {
		t.Fatal(err)
	}
	got, _ := json.Marshal((*bodies)[0]["allowed_updates"])
	if (*methods)[0] != "setWebhook" || string(got) != `["message","callback_query"]` || (*bodies)[0]["secret_token"] != "s" {
		t.Errorf("%s %v", (*methods)[0], (*bodies)[0])
	}
}
