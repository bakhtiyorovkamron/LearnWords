// Package telegram is a minimal Bot API client: sendMessage and setWebhook. The token is part of
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

// SendMessage writes plain text to a chat.
func (c *Client) SendMessage(ctx context.Context, chatID int64, text string) error {
	return c.call(ctx, "sendMessage", map[string]any{"chat_id": chatID, "text": text})
}

// SetWebhook registers url; Telegram then sends secret in X-Telegram-Bot-Api-Secret-Token.
func (c *Client) SetWebhook(ctx context.Context, url, secret string) error {
	return c.call(ctx, "setWebhook", map[string]any{
		"url": url, "secret_token": secret, "allowed_updates": []string{"message"},
	})
}

func (c *Client) call(ctx context.Context, method string, body any) error {
	err := c.do(ctx, method, body)
	if err != nil {
		return errors.New(Redact(err.Error(), c.token))
	}
	return nil
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
	}
	_ = json.NewDecoder(resp.Body).Decode(&out)
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
