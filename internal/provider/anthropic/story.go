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

const storyPromptTemplate = `Ты — автор коротких рассказов для изучающих немецкий язык (уровень A1-B1).
Напиши связный, интересный рассказ на немецком языке в жанре "{{genre}}", обязательно используя ВСЕ следующие слова (можно в нужной грамматической форме):
{{words}}

Требования:
- Длина рассказа примерно {{length}} предложений (чем больше слов, тем длиннее и насыщеннее сюжет).
- Простая грамматика, короткие предложения, понятный сюжет с началом, развитием и концовкой.
- Каждое использованное слово из списка выдели в немецком тексте жирным: **слово**.
- Дай полный перевод рассказа на русский язык.
- Придумай короткий заголовок на немецком.

Ответь ТОЛЬКО в формате JSON, без markdown-обёрток и пояснений:
{
  "title": "...",
  "story_de": "...",
  "story_ru": "..."
}`

// StoryLength scales the story with the number of words.
func StoryLength(n int) string {
	switch {
	case n <= 3:
		return "4-6"
	case n <= 8:
		return "7-10"
	case n <= 15:
		return "10-15"
	default:
		return "15-25"
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

// GenerateStory asks the model for a short German story that uses all given words.
func (c *Client) GenerateStory(ctx context.Context, words []domain.StoryWord, genre string) (domain.GeneratedStory, error) {
	maxTokens := 1200 + 120*len(words)
	if maxTokens > 4000 {
		maxTokens = 4000
	}
	body, err := json.Marshal(request{
		Model:     c.model,
		MaxTokens: maxTokens,
		Messages:  []message{{Role: "user", Content: buildStoryPrompt(words, genre)}},
	})
	if err != nil {
		return domain.GeneratedStory{}, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return domain.GeneratedStory{}, err
	}
	req.Header.Set("x-api-key", c.apiKey)
	req.Header.Set("anthropic-version", apiVersion)
	req.Header.Set("content-type", "application/json")

	httpc := &http.Client{Timeout: 90 * time.Second} // stories are longer than examples
	resp, err := httpc.Do(req)
	if err != nil {
		return domain.GeneratedStory{}, fmt.Errorf("anthropic request: %w", err)
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if err != nil {
		return domain.GeneratedStory{}, err
	}
	var out response
	_ = json.Unmarshal(raw, &out)
	if resp.StatusCode != http.StatusOK {
		msg := resp.Status
		if out.Error != nil {
			msg = out.Error.Message
		}
		return domain.GeneratedStory{}, fmt.Errorf("anthropic api: %s", msg)
	}
	var text strings.Builder
	for _, part := range out.Content {
		if part.Type == "text" {
			text.WriteString(part.Text)
		}
	}
	return ParseStory(text.String())
}

// ParseStory extracts the story JSON, tolerating ```json fences and stray text.
func ParseStory(s string) (domain.GeneratedStory, error) {
	s = strings.TrimSpace(s)
	s = strings.TrimPrefix(s, "```json")
	s = strings.TrimPrefix(s, "```")
	s = strings.TrimSuffix(s, "```")
	if i, j := strings.Index(s, "{"), strings.LastIndex(s, "}"); i >= 0 && j > i {
		s = s[i : j+1]
	}
	var st domain.GeneratedStory
	if err := json.Unmarshal([]byte(s), &st); err != nil {
		return domain.GeneratedStory{}, fmt.Errorf("parse story json: %w", err)
	}
	st.Title = strings.TrimSpace(st.Title)
	st.StoryDE = strings.TrimSpace(st.StoryDE)
	st.StoryRU = strings.TrimSpace(st.StoryRU)
	if st.StoryDE == "" || st.StoryRU == "" {
		return domain.GeneratedStory{}, errors.New("story is incomplete")
	}
	return st, nil
}
