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

// One compact prompt for all learning languages (same JSON shape → shared cache, parser and UI).
// The query may be written in the learning language OR in Russian/Uzbek/English (or another
// language): the model detects it and always returns the word in the learning language.
// conjugation_present keys are positions: ich=1 sg, du=2 sg, er_sie_es=3 sg, wir=1 pl, ihr=2 pl, sie_Sie=3 pl.
const searchPrompt = `Dictionary lookup. Query: "{{query}}".
The query is either a {{target}} word, or a word in Russian, Uzbek, English or another language.
1) Detect the query language (ISO code: de, ru, uz, en, fr, ko, ...). A Latin-script query that is a real Uzbek or English word but not a common {{target}} word is Uzbek/English (e.g. "daftar" is Uzbek "notebook", not German).
2) If the query is not {{target}}, find the main {{target}} equivalent. Put other good {{target}} equivalents into "alternatives" (max 3, nouns with article), else [].
3) "translation" and "example_translation" MUST be in {{trlang}}. "pronunciation" of the {{target}} word written in {{pronscript}}.
{{grammar}}
Return ONLY this JSON (null if not applicable; "word" without article):
{"word":"","word_type":"noun|verb|adjective|adverb|other","article":null,"plural":null,"translation":"","pronunciation":"","verb_type":null,"conjugation_present":null,"perfekt":null,"praeteritum":null,"comparative":null,"superlative":null,"example_sentence":"simple A1-A2 sentence in {{target}}","example_translation":"","alternatives":[],"query_language":""}`

// Per-language grammar notes; field names stay the same for every language.
var searchGrammar = map[string]string{
	"de": `Nouns: article der|die|das, plural (without article). Verbs: verb_type weak|strong, conjugation_present {"ich","du","er_sie_es","wir","ihr","sie_Sie"}, perfekt "hat/ist + Partizip II", praeteritum (3rd sg). Adjectives: comparative, superlative.`,
	"en": `No article. Nouns: plural. Verbs (word without "to"): verb_type regular|irregular, conjugation_present {"ich":"I ...","du":"you ...","er_sie_es":"he/she/it ...","wir":"we ...","ihr":"you ...","sie_Sie":"they ..."}, perfekt = Past Participle, praeteritum = Past Simple. Adjectives: comparative, superlative.`,
	"fr": `Nouns: article le|la by gender (even before a vowel), plural. Verbs: verb_type 1|2|3 (group), conjugation_present {"ich":"je ...","du":"tu ...","er_sie_es":"il/elle ...","wir":"nous ...","ihr":"vous ...","sie_Sie":"ils/elles ..."}, perfekt = passé composé, praeteritum = imparfait (il/elle). Adjectives: comparative, superlative.`,
	"ko": `Word in Hangul (verbs/adjectives in dictionary form ending in 다). No article, plural, conjugation_present. Verbs and adjectives: perfekt = polite past (-았어요/-었어요), praeteritum = polite present (-아요/-어요).`,
}

// Script for the pronunciation hint: readers of a Russian UI read Cyrillic, others read Latin.
func pronScript(trLang string) string {
	if trLang == "ru" {
		return "Russian Cyrillic letters"
	}
	return "simple Latin letters (as an Uzbek/English speaker would read it)"
}

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

func buildSearchPrompt(lang, trLang, query string) string {
	grammar, ok := searchGrammar[lang]
	if !ok {
		grammar = searchGrammar["de"]
	}
	return strings.NewReplacer(
		"{{query}}", clean(query),
		"{{target}}", domain.Lang(lang).NameEN,
		"{{trlang}}", domain.TranslationLangName(trLang),
		"{{pronscript}}", pronScript(trLang),
		"{{grammar}}", grammar,
	).Replace(searchPrompt)
}

// LookupWord returns a dictionary entry for a word in the user's learning language (domain.LangFrom(ctx)).
// The query may be in any language; translations are in domain.TranslationLangFrom(ctx).
// JSON is cut out of the answer and repaired if needed; transient failures are retried once.
func (c *Client) LookupWord(ctx context.Context, query string) (domain.WordInfo, error) {
	trLang := domain.TranslationLangFrom(ctx)
	prompt := buildSearchPrompt(domain.LangFrom(ctx), trLang, query)
	var lastErr error
	for attempt := 1; attempt <= searchAttempts; attempt++ {
		start := time.Now()
		text, err := c.completeWith(ctx, searchModel, prompt, searchPrefill, searchMaxTokens, searchTimeout)
		slog.InfoContext(ctx, "search-word ai call", "attempt", attempt, "took_ms", time.Since(start).Milliseconds(), "ok", err == nil)
		if err == nil {
			info, perr := ParseWordInfo(text)
			if perr == nil {
				info.TranslationLanguage = trLang
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

var articles = map[string]bool{"der": true, "die": true, "das": true, "le": true, "la": true}

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
	w.QueryLanguage = strings.ToLower(strings.TrimSpace(w.QueryLanguage))
	alts := make([]string, 0, len(w.Alternatives))
	seen := map[string]bool{strings.ToLower(w.FullWord()): true, strings.ToLower(w.Word): true}
	for _, a := range w.Alternatives {
		a = strings.Join(strings.Fields(a), " ")
		if a == "" || seen[strings.ToLower(a)] || len(alts) == 3 {
			continue
		}
		seen[strings.ToLower(a)] = true
		alts = append(alts, a)
	}
	w.Alternatives = alts
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
