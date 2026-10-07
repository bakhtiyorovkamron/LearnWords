package anthropic

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"learnwords/internal/domain"
)

// Compact prompt: only the JSON schema + rules. Shorter input and output = faster answer.
const searchPromptTemplate = `Немецкое слово или русский перевод: "{{query}}". Найди немецкое слово и верни JSON строго по схеме (null — если неприменимо; word без артикля):
{"word":"","word_type":"noun|verb|adjective|adverb|other","article":"der|die|das|null","plural":null,"translation":"перевод на русский","pronunciation":"русскими буквами","verb_type":"weak|strong|null","conjugation_present":{"ich":"","du":"","er_sie_es":"","wir":"","ihr":"","sie_Sie":""},"perfekt":"hat/ist + Partizip II","praeteritum":"3 л. ед.ч.","comparative":null,"superlative":null,"example_sentence":"","example_translation":""}
conjugation_present/perfekt/praeteritum/verb_type — только для глаголов, comparative/superlative — для прилагательных, article/plural — для существительных. Только JSON.`

const (
	// Haiku: dictionary data doesn't need Sonnet, and it answers 2-4x faster.
	searchModel     = "claude-haiku-4-5"
	searchMaxTokens = 1000
	// Prefill "{" makes invalid JSON rare, so 2 quick attempts are enough.
	searchAttempts = 2
	searchBackoff  = 400 * time.Millisecond
	searchTimeout  = 30 * time.Second
	searchPrefill  = "{"
)

func buildSearchPrompt(query string) string {
	return strings.ReplaceAll(searchPromptTemplate, "{{query}}", clean(query))
}

// LookupWord returns a dictionary entry for a German word or a Russian translation.
// JSON is cut out of the answer and repaired if needed; transient failures are retried once.
func (c *Client) LookupWord(ctx context.Context, query string) (domain.WordInfo, error) {
	prompt := buildSearchPrompt(query)
	var lastErr error
	for attempt := 1; attempt <= searchAttempts; attempt++ {
		start := time.Now()
		text, err := c.completeWith(ctx, searchModel, prompt, searchPrefill, searchMaxTokens, searchTimeout)
		slog.InfoContext(ctx, "search-word ai call", "attempt", attempt, "took_ms", time.Since(start).Milliseconds(), "ok", err == nil)
		if err == nil {
			info, perr := ParseWordInfo(text)
			if perr == nil {
				return info, nil
			}
			slog.ErrorContext(ctx, "search-word: invalid model output", "err", perr, "raw", text)
			err = retryableError{perr}
		}
		lastErr = err
		var re retryableError
		if !errors.As(err, &re) || ctx.Err() != nil {
			return domain.WordInfo{}, err
		}
		slog.WarnContext(ctx, "search-word attempt failed", "attempt", attempt, "err", err)
		if attempt == searchAttempts {
			break
		}
		select {
		case <-ctx.Done():
			return domain.WordInfo{}, ctx.Err()
		case <-time.After(searchBackoff):
		}
	}
	return domain.WordInfo{}, fmt.Errorf("word lookup failed after %d attempts: %w", searchAttempts, lastErr)
}

// complete performs one Messages API call with the client's default model.
func (c *Client) complete(ctx context.Context, prompt string, maxTokens int, timeout time.Duration) (string, error) {
	return c.completeWith(ctx, c.model, prompt, "", maxTokens, timeout)
}

// completeWith performs one Messages API call and returns the text. A non-empty prefill is sent
// as the start of the assistant's answer and prepended to the returned text (the API doesn't echo it).
// Transient failures (network, 429, 5xx, truncated output) are wrapped in retryableError.
func (c *Client) completeWith(ctx context.Context, model, prompt, prefill string, maxTokens int, timeout time.Duration) (string, error) {
	msgs := []message{{Role: "user", Content: prompt}}
	if prefill != "" {
		msgs = append(msgs, message{Role: "assistant", Content: prefill})
	}
	body, err := json.Marshal(request{
		Model:     model,
		MaxTokens: maxTokens,
		Messages:  msgs,
	})
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

	resp, err := (&http.Client{Timeout: timeout}).Do(req)
	if err != nil {
		return "", retryableError{fmt.Errorf("anthropic request: %w", err)}
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if err != nil {
		return "", retryableError{err}
	}
	var out response
	_ = json.Unmarshal(raw, &out)
	if resp.StatusCode != http.StatusOK {
		msg := resp.Status
		if out.Error != nil {
			msg = out.Error.Message
		}
		apiErr := fmt.Errorf("anthropic api: %s", msg)
		if resp.StatusCode == http.StatusTooManyRequests || resp.StatusCode >= 500 {
			return "", retryableError{apiErr}
		}
		return "", apiErr
	}
	var text strings.Builder
	text.WriteString(prefill)
	for _, part := range out.Content {
		if part.Type == "text" {
			text.WriteString(part.Text)
		}
	}
	if out.StopReason == "max_tokens" {
		return "", retryableError{fmt.Errorf("answer was cut off at %d tokens", maxTokens)}
	}
	return text.String(), nil
}

var articles = map[string]bool{"der": true, "die": true, "das": true}

// ParseWordInfo extracts and normalises the word JSON (fences/extra text tolerated, broken quotes repaired).
func ParseWordInfo(s string) (domain.WordInfo, error) {
	s = extractJSONObject(s)
	var w domain.WordInfo
	if err := json.Unmarshal([]byte(s), &w); err != nil {
		if err2 := json.Unmarshal([]byte(repairJSONStrings(s)), &w); err2 != nil {
			return domain.WordInfo{}, fmt.Errorf("parse word json: %w", err)
		}
	}
	w.Word = strings.TrimSpace(w.Word)
	w.Translation = strings.TrimSpace(w.Translation)
	w.Pronunciation = strings.TrimSpace(w.Pronunciation)
	w.ExampleSentence = strings.TrimSpace(w.ExampleSentence)
	w.ExampleTranslation = strings.TrimSpace(w.ExampleTranslation)
	w.WordType = strings.ToLower(strings.TrimSpace(w.WordType))
	switch w.WordType {
	case "noun", "verb", "adjective", "adverb", "other":
	default:
		w.WordType = "other"
	}
	// Model sometimes puts the article into "word" ("der Hund") — keep it only in "article".
	if f := strings.Fields(w.Word); len(f) > 1 && articles[strings.ToLower(f[0])] {
		if w.Article == nil {
			a := strings.ToLower(f[0])
			w.Article = &a
		}
		w.Word = strings.Join(f[1:], " ")
	}
	w.Article = normNull(w.Article)
	if w.Article != nil {
		a := strings.ToLower(*w.Article)
		if !articles[a] {
			w.Article = nil
		} else {
			w.Article = &a
		}
	}
	w.Plural = normNull(w.Plural)
	w.VerbType = normNull(w.VerbType)
	w.Perfekt = normNull(w.Perfekt)
	w.Praeteritum = normNull(w.Praeteritum)
	w.Comparative = normNull(w.Comparative)
	w.Superlative = normNull(w.Superlative)
	if w.ConjugationPresent != nil && len(*w.ConjugationPresent) == 0 {
		w.ConjugationPresent = nil
	}
	if w.Word == "" || w.Translation == "" {
		return domain.WordInfo{}, errors.New("word or translation is empty")
	}
	return w, nil
}

// normNull turns "", "null", "—" into nil.
func normNull(p *string) *string {
	if p == nil {
		return nil
	}
	v := strings.TrimSpace(*p)
	switch strings.ToLower(v) {
	case "", "null", "none", "-", "—", "n/a":
		return nil
	}
	return &v
}
