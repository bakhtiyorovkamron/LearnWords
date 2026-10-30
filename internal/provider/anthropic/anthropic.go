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

// endpoint is a variable only so tests can point the client at a local server.
var endpoint = "https://api.anthropic.com/v1/messages"

const (
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

const promptTemplate = `Write one simple sentence in {{lang}} (level A1-A2) that uses the word or phrase "{{word}}" (meaning: "{{translation}}").
In "sentence_with_gap" replace the word or phrase with three underscores: ___ — exactly as it appears in the sentence. If it is inflected or has an article (for example "den Tisch" for "der Tisch"), the whole phrase as written in the sentence, article included, becomes ___.
"full_sentence" is the same sentence with the word or phrase filled in.
"translation" is the translation of the full sentence in {{native}} — ONLY the translation, with no explanations in brackets and no grammar comments.
Return ONLY this JSON, without markdown or other text:
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

// buildPrompt: lang is the learning language of the word, nativeLang the language the sentence's
// translation is written in (the user's interface language).
func buildPrompt(lang, nativeLang, word, translation string) string {
	return strings.NewReplacer("{{word}}", clean(word), "{{translation}}", clean(translation),
		"{{lang}}", domain.Lang(lang).NameEN, "{{native}}", domain.TranslationLangName(nativeLang)).Replace(promptTemplate)
}

type request struct {
	Model     string    `json:"model"`
	MaxTokens int       `json:"max_tokens"`
	Messages  []message `json:"messages"`
}

type message struct {
	Role string `json:"role"`
	// Content is a plain string, or a list of content blocks (text, image) for vision requests.
	Content any `json:"content"`
}

type response struct {
	Content []struct {
		Type string `json:"type"`
		Text string `json:"text"`
	} `json:"content"`
	// "end_turn" normally; "max_tokens" means the answer was cut off (JSON incomplete).
	StopReason string `json:"stop_reason"`
	Error      *struct {
		Message string `json:"message"`
	} `json:"error"`
}

// Generate asks the model for an A1-A2 example sentence containing the word (a word or a short
// phrase). The sentence is in the learning language domain.LangFrom(ctx), its translation in the
// interface language domain.TranslationLangFrom(ctx).
func (c *Client) Generate(ctx context.Context, word, translation string) (domain.Example, error) {
	body, err := json.Marshal(request{
		Model:     c.model,
		MaxTokens: 400,
		Messages:  []message{{Role: "user", Content: buildPrompt(domain.LangFrom(ctx), domain.TranslationLangFrom(ctx), word, translation)}},
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
