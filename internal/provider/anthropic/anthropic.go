// Package anthropic is a minimal client for the Anthropic Messages API used to generate example sentences.
package anthropic

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"learnwords/internal/domain"
)

const (
	endpoint     = "https://api.anthropic.com/v1/messages"
	apiVersion   = "2023-06-01"
	DefaultModel = "claude-sonnet-4-6"
)

type Client struct {
	apiKey string
	model  string
	http   *http.Client
}

// New returns a client; the API key comes from the environment (never hardcoded).
func New(apiKey, model string) *Client {
	if model == "" {
		model = DefaultModel
	}
	return &Client{apiKey: apiKey, model: model, http: &http.Client{Timeout: 30 * time.Second}}
}

const promptTemplate = `Создай одно простое предложение на немецком языке (уровень A1-A2) с использованием слова "{{word}}" (перевод: "{{translation}}").
В предложении замени само слово "{{word}}" на три подчёркивания: ___
Дай также перевод полного предложения на русский язык.
Ответь ТОЛЬКО в формате JSON, без markdown и пояснений:
{
  "sentence_with_gap": "...",
  "full_sentence": "...",
  "translation": "..."
}`

// clean strips characters that could break out of the quoted prompt placeholders.
func clean(s string) string {
	s = strings.NewReplacer("\"", "", "\n", " ", "\r", " ").Replace(s)
	return strings.TrimSpace(s)
}

func buildPrompt(word, translation string) string {
	return strings.NewReplacer("{{word}}", clean(word), "{{translation}}", clean(translation)).Replace(promptTemplate)
}

type request struct {
	Model     string    `json:"model"`
	MaxTokens int       `json:"max_tokens"`
	Messages  []message `json:"messages"`
}

type message struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type response struct {
	Content []struct {
		Type string `json:"type"`
		Text string `json:"text"`
	} `json:"content"`
	Error *struct {
		Message string `json:"message"`
	} `json:"error"`
}

// Generate asks the model for an A1-A2 example sentence containing the word.
func (c *Client) Generate(ctx context.Context, word, translation string) (domain.Example, error) {
	body, err := json.Marshal(request{
		Model:     c.model,
		MaxTokens: 400,
		Messages:  []message{{Role: "user", Content: buildPrompt(word, translation)}},
	})
	if err != nil {
		return domain.Example{}, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return domain.Example{}, err
	}
	req.Header.Set("x-api-key", c.apiKey)
	req.Header.Set("anthropic-version", apiVersion)
	req.Header.Set("content-type", "application/json")

	resp, err := c.http.Do(req)
	if err != nil {
		return domain.Example{}, fmt.Errorf("anthropic request: %w", err)
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return domain.Example{}, err
	}
	var out response
	_ = json.Unmarshal(raw, &out)
	if resp.StatusCode != http.StatusOK {
		msg := resp.Status
		if out.Error != nil {
			msg = out.Error.Message
		}
		return domain.Example{}, fmt.Errorf("anthropic api: %s", msg)
	}
	var text strings.Builder
	for _, part := range out.Content {
		if part.Type == "text" {
			text.WriteString(part.Text)
		}
	}
	return ParseExample(text.String())
}

// ParseExample extracts the JSON object from the model output, tolerating ```json fences and stray text.
func ParseExample(s string) (domain.Example, error) {
	s = strings.TrimSpace(s)
	s = strings.TrimPrefix(s, "```json")
	s = strings.TrimPrefix(s, "```")
	s = strings.TrimSuffix(s, "```")
	if i, j := strings.Index(s, "{"), strings.LastIndex(s, "}"); i >= 0 && j > i {
		s = s[i : j+1]
	}
	var ex domain.Example
	if err := json.Unmarshal([]byte(s), &ex); err != nil {
		return domain.Example{}, fmt.Errorf("parse example json: %w", err)
	}
	ex.SentenceWithGap = strings.TrimSpace(ex.SentenceWithGap)
	ex.FullSentence = strings.TrimSpace(ex.FullSentence)
	ex.Translation = strings.TrimSpace(ex.Translation)
	if ex.SentenceWithGap == "" || ex.Translation == "" {
		return domain.Example{}, errors.New("example is incomplete")
	}
	return ex, nil
}
