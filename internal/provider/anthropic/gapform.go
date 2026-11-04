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

	"learnwords/internal/domain"
)

const gapFormPrompt = `The sentence below is in {{lang}} and has a gap marked ___. The gap was made by cutting out a form of the word or phrase "{{word}}".
Sentence: "{{sentence}}"
Answer with the exact text that belongs in the gap, as it must be written there (for example the conjugated verb "schmeckt" for "schmecken", or "den Tisch" with the article for "der Tisch"). If the word fits unchanged, answer with the word itself.
Return ONLY this JSON, without markdown or other text:
{"gap_answer": "..."}`

// GapForm asks the model which form of word stands in the gap of sentenceWithGap. The sentence is
// in the learning language domain.LangFrom(ctx). It is meant for the one-off backfill of cards
// saved before example_gap_answer existed; the answer is not checked against a full sentence
// (there is none), only for being a single short line.
func (c *Client) GapForm(ctx context.Context, sentenceWithGap, word string) (string, error) {
	prompt := strings.NewReplacer("{{lang}}", domain.Lang(domain.LangFrom(ctx)).NameEN,
		"{{word}}", clean(word), "{{sentence}}", clean(sentenceWithGap)).Replace(gapFormPrompt)
	body, err := json.Marshal(request{Model: c.model, MaxTokens: 100, Messages: []message{{Role: "user", Content: prompt}}})
	if err != nil {
		return "", err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("x-api-key", c.apiKey)
	req.Header.Set("anthropic-version", apiVersion)
	req.Header.Set("content-type", "application/json")
	resp, err := c.http.Do(req)
	if err != nil {
		return "", fmt.Errorf("anthropic request: %w", err)
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return "", err
	}
	var out response
	_ = json.Unmarshal(raw, &out)
	if resp.StatusCode != http.StatusOK {
		msg := resp.Status
		if out.Error != nil {
			msg = out.Error.Message
		}
		return "", fmt.Errorf("anthropic api: %s", msg)
	}
	var text strings.Builder
	for _, part := range out.Content {
		if part.Type == "text" {
			text.WriteString(part.Text)
		}
	}
	return ParseGapForm(text.String())
}

// ParseGapForm extracts {"gap_answer": "..."} from the model output.
func ParseGapForm(s string) (string, error) {
	s = strings.TrimSpace(s)
	s = strings.TrimPrefix(s, "```json")
	s = strings.TrimPrefix(s, "```")
	s = strings.TrimSuffix(s, "```")
	if i, j := strings.Index(s, "{"), strings.LastIndex(s, "}"); i >= 0 && j > i {
		s = s[i : j+1]
	}
	var v struct {
		GapAnswer string `json:"gap_answer"`
	}
	if err := json.Unmarshal([]byte(s), &v); err != nil {
		return "", fmt.Errorf("parse gap form json: %w", err)
	}
	a := strings.TrimSpace(v.GapAnswer)
	if a == "" || strings.ContainsAny(a, "\n_") || len([]rune(a)) > 100 {
		return "", errors.New("gap form is empty or malformed")
	}
	return a, nil
}
