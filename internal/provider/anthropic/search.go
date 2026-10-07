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

const searchPromptTemplate = `Пользователь ищет немецкое слово (или дал перевод, по которому нужно найти немецкое слово): "{{query}}"

Определи, какое это слово (если дан русский перевод — найди соответствующее немецкое слово). Верни информацию о нём.

Если слово — существительное: добавь артикль (der/die/das) и форму множественного числа. В поле "word" пиши слово БЕЗ артикля.
Если слово — глагол: укажи, слабый он или сильный, дай спряжение в Präsens (ich/du/er/wir/ihr/sie) и форму Perfekt (hat/ist + Partizip II), а также Präteritum (прошедшее время, 3-е лицо ед.ч.).
Если слово — прилагательное: дай степени сравнения (Komparativ, Superlativ), если применимо.

Ответь ТОЛЬКО валидным JSON, без пояснений до или после объекта и без markdown. Все строки должны быть корректно экранированы для JSON:
{
  "word": "немецкое слово",
  "word_type": "noun | verb | adjective | adverb | other",
  "article": "der/die/das или null, если не существительное",
  "plural": "форма множественного числа или null",
  "translation": "перевод на русский",
  "pronunciation": "произношение русскими буквами",
  "verb_type": "weak | strong | null",
  "conjugation_present": {"ich": "...", "du": "...", "er_sie_es": "...", "wir": "...", "ihr": "...", "sie_Sie": "..."} или null,
  "perfekt": "строка вида 'hat gemacht' или null",
  "praeteritum": "строка, например 'machte' или null",
  "comparative": "форма сравнительной степени или null",
  "superlative": "форма превосходной степени или null",
  "example_sentence": "пример предложения на немецком",
  "example_translation": "перевод примера на русский"
}`

const (
	searchAttempts  = 3
	searchMaxTokens = 1500
)

func buildSearchPrompt(query string) string {
	return strings.ReplaceAll(searchPromptTemplate, "{{query}}", clean(query))
}

// LookupWord returns a dictionary entry for a German word or a Russian translation.
// Same robustness as the daily story: JSON is cut out of the answer, repaired if needed,
// and the call is retried on bad JSON / overload / network errors.
func (c *Client) LookupWord(ctx context.Context, query string) (domain.WordInfo, error) {
	prompt := buildSearchPrompt(query)
	var lastErr error
	for attempt := 1; attempt <= searchAttempts; attempt++ {
		text, err := c.complete(ctx, prompt, searchMaxTokens, 60*time.Second)
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
		select {
		case <-ctx.Done():
			return domain.WordInfo{}, ctx.Err()
		case <-time.After(time.Duration(attempt) * time.Second):
		}
	}
	return domain.WordInfo{}, fmt.Errorf("word lookup failed after %d attempts: %w", searchAttempts, lastErr)
}

// complete performs one Messages API call and returns the concatenated text.
// Transient failures (network, 429, 5xx, truncated output) are wrapped in retryableError.
func (c *Client) complete(ctx context.Context, prompt string, maxTokens int, timeout time.Duration) (string, error) {
	body, err := json.Marshal(request{
		Model:     c.model,
		MaxTokens: maxTokens,
		Messages:  []message{{Role: "user", Content: prompt}},
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
