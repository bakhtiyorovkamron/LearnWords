// Package telegram is a minimal Bot API client: sendMessage (with link or callback buttons),
// editMessageText, answerCallbackQuery and setWebhook. The token is part of
// every request URL, so it is scrubbed from every error this package returns.
package telegram

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"learnwords/internal/domain"
)

const defaultBaseURL = "https://api.telegram.org"

type Client struct {
	token   string
	baseURL string
	http    *http.Client
}

func New(token string) *Client {
	return &Client{token: token, baseURL: defaultBaseURL, http: &http.Client{Timeout: 10 * time.Second}}
}

// WithBaseURL points the client at another server (tests).
func (c *Client) WithBaseURL(u string) *Client {
	c.baseURL = strings.TrimRight(u, "/")
	return c
}

// ErrBotBlocked and RetryAfterError are what a send returns for HTTP 403 and 429 (see domain).
var ErrBotBlocked = domain.ErrBotBlocked

type RetryAfterError = domain.RetryAfterError

// SendMessage writes plain text (no parse_mode) to a chat, with an optional inline link button
// under it. A 403 is ErrBotBlocked, a 429 a *RetryAfterError.
func (c *Client) SendMessage(ctx context.Context, chatID int64, text string, button *domain.TelegramButton) error {
	body := map[string]any{"chat_id": chatID, "text": text}
	if button != nil {
		body["reply_markup"] = map[string]any{"inline_keyboard": [][]map[string]string{{{"text": button.Text, "url": button.URL}}}}
	}
	return c.call(ctx, "sendMessage", body)
}

// InlineButton is a button that sends its callback data back to the bot (see domain).
type InlineButton = domain.InlineButton

// SendMessageButtons writes plain text with rows of callback buttons under it (the bot gets a
// callback_query when one is pressed). Errors as SendMessage.
func (c *Client) SendMessageButtons(ctx context.Context, chatID int64, text string, rows [][]InlineButton) error {
	return c.call(ctx, "sendMessage", map[string]any{
		"chat_id": chatID, "text": text, "reply_markup": map[string]any{"inline_keyboard": rows},
	})
}

// EditMessageText replaces the text of a message the bot sent; the buttons under it are removed.
func (c *Client) EditMessageText(ctx context.Context, chatID, messageID int64, text string) error {
	return c.call(ctx, "editMessageText", map[string]any{"chat_id": chatID, "message_id": messageID, "text": text})
}

// AnswerCallbackQuery stops the spinner on the pressed button (Telegram expects it for every
// callback_query).
func (c *Client) AnswerCallbackQuery(ctx context.Context, callbackID string) error {
	return c.call(ctx, "answerCallbackQuery", map[string]any{"callback_query_id": callbackID})
}

// SetWebhook registers url; Telegram then sends secret in X-Telegram-Bot-Api-Secret-Token. The bot
// reads messages and button presses (the sign-in question).
func (c *Client) SetWebhook(ctx context.Context, url, secret string) error {
	return c.call(ctx, "setWebhook", map[string]any{
		"url": url, "secret_token": secret, "allowed_updates": []string{"message", "callback_query"},
	})
}

func (c *Client) call(ctx context.Context, method string, body any) error {
	err := c.do(ctx, method, body)
	if err == nil {
		return nil
	}
	var retry *domain.RetryAfterError
	if errors.Is(err, domain.ErrBotBlocked) || errors.As(err, &retry) {
		return err // built from Telegram's description only: no token in it
	}
	return errors.New(Redact(err.Error(), c.token))
}

func (c *Client) do(ctx context.Context, method string, body any) error {
	raw, err := json.Marshal(body)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/bot"+c.token+"/"+method, bytes.NewReader(raw))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("telegram %s: %w", method, err)
	}
	defer resp.Body.Close()
	var out struct {
		OK          bool   `json:"ok"`
		Description string `json:"description"`
		Parameters  struct {
			RetryAfter int `json:"retry_after"`
		} `json:"parameters"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&out)
	switch resp.StatusCode {
	case http.StatusForbidden:
		return fmt.Errorf("%w: %s", domain.ErrBotBlocked, out.Description)
	case http.StatusTooManyRequests:
		return &domain.RetryAfterError{Seconds: max(out.Parameters.RetryAfter, 1)}
	}
	if resp.StatusCode != http.StatusOK || !out.OK {
		return fmt.Errorf("telegram %s: status %d: %s", method, resp.StatusCode, out.Description)
	}
	return nil
}

// Redact replaces the bot token in s (for logs and errors).
func Redact(s, token string) string {
	if token == "" {
		return s
	}
	return strings.ReplaceAll(s, token, "<redacted>")
}
