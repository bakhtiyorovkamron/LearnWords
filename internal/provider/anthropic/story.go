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

const storyPromptTemplate = `Ты — автор коротких рассказов для изучающих немецкий язык (уровень A1-B1).
Напиши связный, интересный рассказ на немецком языке в жанре "{{genre}}", обязательно используя ВСЕ следующие слова (можно в нужной грамматической форме):
{{words}}

Требования:
- Длина рассказа примерно {{length}} предложений (чем больше слов, тем длиннее и насыщеннее сюжет).
- Простая грамматика, короткие предложения, понятный сюжет с началом, развитием и концовкой.
- Каждое использованное слово из списка выдели в немецком тексте жирным: **слово**.
- Дай полный перевод рассказа на русский язык.
- Придумай короткий заголовок на немецком.

ФОРМАТ ОТВЕТА — СТРОГО ВАЖНО:
- Ответь СТРОГО одним валидным JSON-объектом, без каких-либо пояснений до или после объекта и без markdown-разметки (никаких ` + "```" + `).
- Весь текст внутри полей должен быть корректно экранирован для JSON.
- НЕ используй прямые двойные кавычки " внутри текста. Для прямой речи и цитат используй только кавычки „…“ (в немецком) и «…» (в русском).
- Абзацы разделяй последовательностью \n (экранированный перенос строки), а не настоящим переносом строки.

Структура ответа:
{"title": "...", "story_de": "...", "story_ru": "..."}`

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

func buildStoryPrompt(words []domain.StoryWord, genre string) string {
	var b strings.Builder
	for _, w := range words {
		fmt.Fprintf(&b, "- %s (%s)\n", clean(w.Word), clean(w.Translation))
	}
	return strings.NewReplacer(
		"{{genre}}", clean(genre),
		"{{words}}", strings.TrimRight(b.String(), "\n"),
		"{{length}}", StoryLength(len(words)),
	).Replace(storyPromptTemplate)
}

// storyMaxTokens: German + Russian text, Cyrillic is token-heavy → generous budget per word.
func storyMaxTokens(words int) int {
	n := 2000 + 200*words
	if n > 6000 {
		n = 6000
	}
	return n
}

const storyAttempts = 3

// retryableError marks failures worth another try (bad/truncated JSON, overload, network).
type retryableError struct{ err error }

func (e retryableError) Error() string { return e.err.Error() }
func (e retryableError) Unwrap() error { return e.err }

// GenerateStory asks the model for a short German story that uses all given words.
// Invalid or truncated JSON is retried (up to storyAttempts in total), with a bigger
// token budget after a truncation.
func (c *Client) GenerateStory(ctx context.Context, words []domain.StoryWord, genre string) (domain.GeneratedStory, error) {
	prompt := buildStoryPrompt(words, genre)
	maxTokens := storyMaxTokens(len(words))
	var lastErr error
	for attempt := 1; attempt <= storyAttempts; attempt++ {
		st, truncated, err := c.storyOnce(ctx, prompt, maxTokens)
		if err == nil {
			return st, nil
		}
		lastErr = err
		var re retryableError
		if !errors.As(err, &re) || ctx.Err() != nil {
			return domain.GeneratedStory{}, err
		}
		slog.WarnContext(ctx, "story generation attempt failed",
			"attempt", attempt, "max_tokens", maxTokens, "truncated", truncated, "err", err)
		if truncated && maxTokens < 8000 {
			maxTokens = min(maxTokens*3/2, 8000)
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
	st.StoryRU = strings.TrimSpace(st.StoryRU)
	if st.StoryDE == "" || st.StoryRU == "" {
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
