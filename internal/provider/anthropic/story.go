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
	"unicode"

	"learnwords/internal/domain"
)

// Story generation is two separate model calls:
//  1. generateStoryOnce builds the story in the learning language ONLY — the word list passed
//     in has no translations attached, so there is nothing non-German (etc.) for the model to
//     echo into the text. A Cyrillic-character check catches it anyway if the model slips.
//  2. TranslateStory translates the already-generated text (+ a gloss per word) into whichever
//     native language a viewer actually requested — lazily, once per (story, language), cached.
const storyPromptTemplate = `You are a short-story author for {{target}} learners (level A1-B1).
Write a connected, engaging story in the genre "{{genre}}", using ALL of the following {{target}} words (any grammatical form is fine):
{{words}}

Requirements:
- The ENTIRE story and its title must be written 100% in {{target}} — not a single word, phrase or name from any other language or script may appear anywhere in them.
- About {{length}} sentences (more words → a longer, richer plot).
- Simple grammar, short sentences, a clear beginning, middle and end.
- Bold every used word from the list in the text: **word**.

ANSWER FORMAT — STRICT:
- Respond with ONLY one valid JSON object, no text before or after it, no markdown fences.
- Escape all text correctly for JSON. Do not use straight double quotes " inside the text — use „…“ or «…» for dialogue/quotes.
- Separate paragraphs with \n (escaped), not a real newline.

{"title": "...", "story_de": "..."}`

const reinforceStory = `
IMPORTANT: your previous answer mixed in text from another language — every word of "title" and "story_de" must be {{target}} only. Write it again, entirely in {{target}}.`

// StoryLength scales the story with the number of words.
func StoryLength(n int) string {
	switch {
	case n <= 3:
		return "4-6"
	case n <= 8:
		return "7-10"
	default:
		return "10-15"
	}
}

// buildStoryPrompt never receives translations — only the learning-language spellings — so the
// model has no foreign-language text available to leak into the story.
func buildStoryPrompt(learningLang string, words []domain.StoryWord, genre string, reinforce bool) string {
	target := domain.Lang(learningLang).NameEN
	var b strings.Builder
	for _, w := range words {
		fmt.Fprintf(&b, "- %s\n", clean(w.Word))
	}
	p := strings.NewReplacer(
		"{{target}}", target,
		"{{genre}}", clean(genre),
		"{{words}}", strings.TrimRight(b.String(), "\n"),
		"{{length}}", StoryLength(len(words)),
	).Replace(storyPromptTemplate)
	if reinforce {
		p += strings.NewReplacer("{{target}}", target).Replace(reinforceStory)
	}
	return p
}

// containsCyrillic reports whether s has any Cyrillic character — a sign the model slipped
// into Russian instead of writing purely in the learning language.
func containsCyrillic(s string) bool {
	for _, r := range s {
		if unicode.Is(unicode.Cyrillic, r) {
			return true
		}
	}
	return false
}

// storyMaxTokens: learning-language text only now (translation is a separate, later call).
func storyMaxTokens(words int) int {
	n := 1200 + 100*words
	if n > 3000 {
		n = 3000
	}
	return n
}

const storyAttempts = 3

// retryableError marks failures worth another try (bad/truncated JSON, overload, network).
type retryableError struct{ err error }

func (e retryableError) Error() string { return e.err.Error() }
func (e retryableError) Unwrap() error { return e.err }

// GenerateStory asks the model for a short story in the user's learning language that uses all
// given words. Invalid/truncated JSON AND Cyrillic leaking into the text are both retried (up
// to storyAttempts in total — i.e. at most 2 regenerations after the first attempt), each retry
// reinforcing that the whole answer must be in the learning language.
func (c *Client) GenerateStory(ctx context.Context, words []domain.StoryWord, genre string) (domain.GeneratedStory, error) {
	learningLang := domain.LangFrom(ctx)
	maxTokens := storyMaxTokens(len(words))
	var lastErr error
	for attempt := 1; attempt <= storyAttempts; attempt++ {
		prompt := buildStoryPrompt(learningLang, words, genre, attempt > 1)
		st, truncated, err := c.storyOnce(ctx, prompt, maxTokens)
		if err == nil {
			if containsCyrillic(st.Title) || containsCyrillic(st.StoryDE) {
				err = retryableError{errors.New("story text contains Cyrillic characters")}
			} else {
				return st, nil
			}
		}
		lastErr = err
		var re retryableError
		if !errors.As(err, &re) || ctx.Err() != nil {
			return domain.GeneratedStory{}, err
		}
		slog.WarnContext(ctx, "story generation attempt failed",
			"attempt", attempt, "max_tokens", maxTokens, "truncated", truncated, "err", err)
		if truncated && maxTokens < 6000 {
			maxTokens = min(maxTokens*3/2, 6000)
		}
		if attempt == storyAttempts {
			break
		}
		select {
		case <-ctx.Done():
			return domain.GeneratedStory{}, ctx.Err()
		case <-time.After(time.Duration(attempt) * time.Second):
		}
	}
	return domain.GeneratedStory{}, fmt.Errorf("story generation failed after %d attempts: %w", storyAttempts, lastErr)
}

// storyOnce performs one API call. truncated=true means the model hit max_tokens.
func (c *Client) storyOnce(ctx context.Context, prompt string, maxTokens int) (domain.GeneratedStory, bool, error) {
	body, err := json.Marshal(request{
		Model:     c.model,
		MaxTokens: maxTokens,
		Messages:  []message{{Role: "user", Content: prompt}},
	})
	if err != nil {
		return domain.GeneratedStory{}, false, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return domain.GeneratedStory{}, false, err
	}
	req.Header.Set("x-api-key", c.apiKey)
	req.Header.Set("anthropic-version", apiVersion)
	req.Header.Set("content-type", "application/json")

	httpc := &http.Client{Timeout: 120 * time.Second} // stories are longer than examples
	resp, err := httpc.Do(req)
	if err != nil {
		return domain.GeneratedStory{}, false, retryableError{fmt.Errorf("anthropic request: %w", err)}
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if err != nil {
		return domain.GeneratedStory{}, false, retryableError{err}
	}
	var out response
	_ = json.Unmarshal(raw, &out)
	if resp.StatusCode != http.StatusOK {
		msg := resp.Status
		if out.Error != nil {
			msg = out.Error.Message
		}
		apiErr := fmt.Errorf("anthropic api: %s", msg)
		// 429 rate limit, 5xx and 529 "overloaded" are transient; other 4xx (bad key etc.) are not.
		if resp.StatusCode == http.StatusTooManyRequests || resp.StatusCode >= 500 {
			return domain.GeneratedStory{}, false, retryableError{apiErr}
		}
		return domain.GeneratedStory{}, false, apiErr
	}
	var text strings.Builder
	for _, part := range out.Content {
		if part.Type == "text" {
			text.WriteString(part.Text)
		}
	}
	truncated := out.StopReason == "max_tokens"
	st, err := ParseStory(text.String())
	if err != nil {
		// Full raw model output for debugging (not shown to the user).
		slog.ErrorContext(ctx, "story: invalid model output",
			"err", err, "stop_reason", out.StopReason, "raw", text.String())
		if truncated {
			err = fmt.Errorf("answer was cut off at %d tokens: %w", maxTokens, err)
		}
		return domain.GeneratedStory{}, truncated, retryableError{err}
	}
	return st, truncated, nil
}

// ParseStory extracts the story JSON from the model output. It tolerates ```json fences,
// text before/after the object and, as a last resort, unescaped quotes/newlines inside strings.
func ParseStory(s string) (domain.GeneratedStory, error) {
	s = extractJSONObject(s)
	var st domain.GeneratedStory
	err := json.Unmarshal([]byte(s), &st)
	if err != nil {
		if err2 := json.Unmarshal([]byte(repairJSONStrings(s)), &st); err2 != nil {
			return domain.GeneratedStory{}, fmt.Errorf("parse story json: %w", err)
		}
	}
	st.Title = strings.TrimSpace(st.Title)
	st.StoryDE = strings.TrimSpace(st.StoryDE)
	if st.StoryDE == "" {
		return domain.GeneratedStory{}, errors.New("story is incomplete")
	}
	return st, nil
}

// extractJSONObject strips markdown fences and keeps only the range from the first '{' to the last '}'.
func extractJSONObject(s string) string {
	s = strings.TrimSpace(s)
	if strings.HasPrefix(s, "```") {
		if nl := strings.IndexByte(s, '\n'); nl >= 0 {
			s = s[nl+1:] // drops "```json" / "```"
		}
		s = strings.TrimSuffix(strings.TrimSpace(s), "```")
	}
	if i, j := strings.Index(s, "{"), strings.LastIndex(s, "}"); i >= 0 && j > i {
		s = s[i : j+1]
	}
	return strings.TrimSpace(s)
}

// repairJSONStrings fixes the most common LLM JSON mistakes inside string values:
// unescaped double quotes (e.g. „Hallo" or "Anna" in a dialogue) and raw newlines/tabs.
// A quote inside a string is treated as closing only if the next non-space character is
// one of , } ] : — otherwise it is escaped as part of the text.
func repairJSONStrings(s string) string {
	var b strings.Builder
	b.Grow(len(s) + 32)
	inString, escaped := false, false
	for i := 0; i < len(s); i++ {
		ch := s[i]
		if !inString {
			if ch == '"' {
				inString = true
			}
			b.WriteByte(ch)
			continue
		}
		switch {
		case escaped:
			escaped = false
			b.WriteByte(ch)
		case ch == '\\':
			escaped = true
			b.WriteByte(ch)
		case ch == '\n':
			b.WriteString(`\n`)
		case ch == '\r':
			// dropped
		case ch == '\t':
			b.WriteString(`\t`)
		case ch == '"':
			if closesString(s, i+1) {
				inString = false
				b.WriteByte(ch)
			} else {
				b.WriteString(`\"`)
			}
		default:
			b.WriteByte(ch)
		}
	}
	return b.String()
}

func closesString(s string, from int) bool {
	for j := from; j < len(s); j++ {
		switch s[j] {
		case ' ', '\t', '\n', '\r':
			continue
		case ',', '}', ']', ':':
			return true
		default:
			return false
		}
	}
	return true // end of input
}
