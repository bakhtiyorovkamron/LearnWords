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
	"regexp"
	"strings"
	"time"

	"learnwords/internal/domain"
)

// Word lookup is split into two model calls:
//  1. resolveWord (Sonnet) decides what language the query is in and what the exact
//     learning-language word is. This is the hard, error-prone part — Haiku was found to
//     mis-translate short native-language function words (pronouns like Uzbek "sen"/"u"),
//     returning them unchanged instead of the German equivalent.
//  2. assembleCard (Haiku) fills in the rest of the dictionary card (grammar, translation,
//     pronunciation, example sentence) for the word already resolved by step 1. This is cheap
//     formatting work that Haiku handles reliably once it isn't also asked to disambiguate languages.
//
// The user has a NATIVE language (the UI language: uz/ru/en) and a LEARNING language (de/en/fr/ko).
// conjugation_present keys are positions: ich=1 sg, du=2 sg, er_sie_es=3 sg, wir=1 pl, ihr=2 pl, sie_Sie=3 pl.
const resolvePrompt = `Translate a dictionary query between two languages.
native_language: {{native}} (the user's native language)
learning_language: {{target}} (the language the user is learning)
Query: "{{query}}"

Decide what the query means and return its {{target}} equivalent.
Rules:
1) The query is most likely a {{native}} word. Check this first. If it is, translate it BY MEANING to {{target}} — this includes personal pronouns, question words and other short function words, which must be translated too, never copied as-is.
2) Only treat the query as a {{target}} word if it is an exact, correctly spelled {{target}} word AND it is not also a {{native}} word. Never pick a {{target}} word merely because it starts with the same letters or looks similar to the query.
3) "word" is ALWAYS written in {{target}}. It may equal the raw query text only when rule 2 applies. If the query is {{native}} (query_language different from {{targetcode}}), "word" must be different from the query text — returning the {{native}} query unchanged is always wrong, even for short words like pronouns.
4) If the query spelling matches a word in both {{native}} and {{target}} (truly ambiguous), set "word"/"article" to the {{native}} meaning and put the {{target}} spelling match — plus up to 2 other good {{target}} equivalents, nouns with article — into "alternatives". Otherwise alternatives = [].
5) "alternatives" entries are bare {{target}} words or short phrases only: no parentheses, no explanations, no words from any other language.
6) "query_language": ISO code of the language you decided the query is written in (e.g. {{nativecode}}, {{targetcode}}, ru, en).
{{hints}}
Return ONLY this JSON ("word" without article, null if not applicable):
{"word":"","article":null,"alternatives":[],"query_language":""}`

// reinforceResolve is appended to the prompt on the retry after a validation failure
// (the model returned the native query unchanged as "word").
const reinforceResolve = `
IMPORTANT: your previous answer returned the {{native}} query text unchanged as "word" — that is wrong. Return the actual {{target}} translation (a different word) instead.`

// Short few-shot hints (native → German), including the personal pronouns that are most
// often mistranslated, to pin down the "translate by meaning, even for short words" behaviour.
// For other learning languages the rules alone are used.
var resolveHints = map[string]string{
	"uz": `Examples: "men"→"ich" (not "der Mensch"); "sen"→"du"; "u"→"er" (also "sie"/"es" depending on context); "biz"→"wir"; "siz"→"ihr" (or "Sie" for polite); "ular"→"sie"; "daftar"→"das Heft"; "kitob"→"das Buch"; "olma"→"der Apfel"; "uy"→"das Haus". Reverse: German "ich" (query_language "de") → word "ich".`,
	"ru": `Examples: "тетрадь"→"das Heft"; "я"→"ich"; "ты"→"du"; "он"/"она"→"er"/"sie". Reverse: German "ich" (query_language "de") → word "ich".`,
	"en": `Examples: "notebook"→"das Heft"; "I"→"ich"; "you"→"du". Reverse: German "ich" (query_language "de") → word "ich".`,
}

// cardPrompt asks for the rest of the dictionary card once the target-language word is already known.
const cardPrompt = `Dictionary card for the {{target}} word "{{word}}"{{articleNote}}, for a learner whose native language is {{native}}.
Fill in the fields below for exactly this word and meaning (the original query was in: {{querylang}}). Do not translate a different word and do not change "word".
"translation" and "example_translation" MUST be written in {{native}}. "pronunciation" of the {{target}} word, written in {{pronscript}}.
"example_sentence" MUST be a simple A1-A2 sentence written ENTIRELY in {{target}} — no {{native}} or English words mixed in, no parentheses or notes — and it must contain the word.
{{grammar}}
Return ONLY this JSON ("word" unchanged, null if not applicable):
{"word":"{{word}}","word_type":"noun|verb|adjective|adverb|other","plural":null,"verb_type":null,"conjugation_present":null,"perfekt":null,"praeteritum":null,"comparative":null,"superlative":null,"translation":"","pronunciation":"","example_sentence":"","example_translation":""}`

// reinforceCard is appended on the retry after the example sentence failed validation
// (it mixed in native-language/English text or contained a parenthetical note).
const reinforceCard = `
IMPORTANT: your previous "example_sentence" was not clean {{target}}-only text (it mixed in another language or contained a parenthetical note). Write a new A1-A2 sentence using only {{target}} words this time.`

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
	// Resolving the target-language word is the hard, disambiguation-heavy part (language
	// detection + translation of short function words) — Haiku was found unreliable at it.
	searchResolveModel     = DefaultModel // "claude-sonnet-4-6"
	searchResolveMaxTokens = 300
	// Haiku: once the word is already resolved, the rest is cheap formatting/dictionary lookup.
	searchModel     = "claude-haiku-4-5"
	searchMaxTokens = 1000
	// Prefill "{" makes invalid JSON rare, so 2 quick attempts are enough.
	searchAttempts = 2
	searchBackoff  = 400 * time.Millisecond
	searchTimeout  = 30 * time.Second
	searchPrefill  = "{"
)

func buildResolvePrompt(targetCode, native, query string, reinforce bool) string {
	learning := domain.Lang(targetCode)
	native = domain.NormTranslationLang(native)
	hints := "none"
	if learning.Code == "de" {
		hints = resolveHints[native]
	}
	p := strings.NewReplacer(
		"{{query}}", clean(query),
		"{{target}}", learning.NameEN,
		"{{targetcode}}", learning.Code,
		"{{native}}", domain.TranslationLangName(native),
		"{{nativecode}}", native,
		"{{hints}}", hints,
	).Replace(resolvePrompt)
	if reinforce {
		p += strings.NewReplacer(
			"{{native}}", domain.TranslationLangName(native),
			"{{target}}", learning.NameEN,
		).Replace(reinforceResolve)
	}
	return p
}

func buildCardPrompt(targetCode, native string, resolved domain.WordInfo, reinforce bool) string {
	learning := domain.Lang(targetCode)
	native = domain.NormTranslationLang(native)
	grammar, ok := searchGrammar[learning.Code]
	if !ok {
		grammar = searchGrammar["de"]
	}
	articleNote := ""
	if resolved.Article != nil && *resolved.Article != "" {
		articleNote = fmt.Sprintf(" (article: %s)", *resolved.Article)
	}
	p := strings.NewReplacer(
		"{{word}}", clean(resolved.Word),
		"{{articleNote}}", articleNote,
		"{{target}}", learning.NameEN,
		"{{native}}", domain.TranslationLangName(native),
		"{{querylang}}", resolved.QueryLanguage,
		"{{pronscript}}", pronScript(native),
		"{{grammar}}", grammar,
	).Replace(cardPrompt)
	if reinforce {
		p += strings.NewReplacer("{{target}}", learning.NameEN).Replace(reinforceCard)
	}
	return p
}

// validateResolution catches the model returning the native query untranslated as the target
// word (the production bug: Uzbek "sen" → word "sen" instead of "du"), and explanation text
// leaking into "alternatives" (e.g. "du (sen - 2nd person singular informal pronoun in German)").
func validateResolution(w domain.WordInfo, targetCode, query string) error {
	if w.QueryLanguage != targetCode && strings.EqualFold(strings.TrimSpace(w.Word), strings.TrimSpace(query)) {
		return fmt.Errorf("word %q equals the %s query verbatim, expected a %s translation", w.Word, w.QueryLanguage, targetCode)
	}
	for _, a := range w.Alternatives {
		if strings.ContainsAny(a, "()") {
			return fmt.Errorf("alternative %q contains an explanation", a)
		}
	}
	return nil
}

// validateCard rejects an example sentence that isn't clean target-language text: a parenthetical
// note, or a sentence that is actually still written in the original (native) query language.
func validateCard(card domain.WordInfo, targetCode, query string, resolved domain.WordInfo) error {
	if strings.ContainsAny(card.ExampleSentence, "()") {
		return fmt.Errorf("example_sentence contains a parenthetical note: %q", card.ExampleSentence)
	}
	if resolved.QueryLanguage != targetCode && containsWord(card.ExampleSentence, query) {
		return fmt.Errorf("example_sentence looks like it is in %s, not %s: %q", resolved.QueryLanguage, targetCode, card.ExampleSentence)
	}
	return nil
}

// containsWord reports whether sentence contains word as a standalone token (case-insensitive).
func containsWord(sentence, word string) bool {
	word = strings.TrimSpace(word)
	if word == "" {
		return false
	}
	re := regexp.MustCompile(`(?i)\b` + regexp.QuoteMeta(word) + `\b`)
	return re.MatchString(sentence)
}

// LookupWord returns a dictionary entry for a word in the user's learning language (domain.LangFrom(ctx)).
// The query is most likely in the native language (domain.TranslationLangFrom(ctx)); translations are in it.
// See the comment above resolvePrompt for why this is two model calls instead of one.
func (c *Client) LookupWord(ctx context.Context, query string) (domain.WordInfo, error) {
	trLang := domain.TranslationLangFrom(ctx)
	targetCode := domain.Lang(domain.LangFrom(ctx)).Code

	resolved, err := c.resolveWord(ctx, targetCode, trLang, query)
	if err != nil {
		return domain.WordInfo{}, err
	}
	card, err := c.assembleCard(ctx, targetCode, trLang, query, resolved)
	if err != nil {
		return domain.WordInfo{}, err
	}
	card.Word, card.Article, card.Alternatives, card.QueryLanguage = resolved.Word, resolved.Article, resolved.Alternatives, resolved.QueryLanguage
	card.TranslationLanguage = trLang
	return card, nil
}

// resolveWord decides the target-language word and the query's language. A validation failure
// (not just a transient API error) is retried once with a reinforced prompt before giving up —
// an invalid result is never returned (and so never reaches the cache or the client).
func (c *Client) resolveWord(ctx context.Context, targetCode, native, query string) (domain.WordInfo, error) {
	prompts := []string{
		buildResolvePrompt(targetCode, native, query, false),
		buildResolvePrompt(targetCode, native, query, true),
	}
	var lastErr error
	for i, prompt := range prompts {
		// claude-sonnet-4-6 rejects an assistant-prefilled turn ("the conversation must end
		// with a user message") — no prefill for the resolve step.
		info, err := c.callAndParse(ctx, searchResolveModel, prompt, "", searchResolveMaxTokens, parseResolution)
		if err != nil {
			lastErr = err
			slog.WarnContext(ctx, "search-word resolve attempt failed", "attempt", i+1, "err", err)
			continue
		}
		if verr := validateResolution(info, targetCode, query); verr != nil {
			lastErr = verr
			slog.WarnContext(ctx, "search-word resolve validation failed", "attempt", i+1, "err", verr)
			continue
		}
		return info, nil
	}
	return domain.WordInfo{}, fmt.Errorf("could not resolve a %s word for %q: %w", targetCode, query, lastErr)
}

// assembleCard fills in the rest of the dictionary card for the already-resolved word.
func (c *Client) assembleCard(ctx context.Context, targetCode, native, query string, resolved domain.WordInfo) (domain.WordInfo, error) {
	prompts := []string{
		buildCardPrompt(targetCode, native, resolved, false),
		buildCardPrompt(targetCode, native, resolved, true),
	}
	var lastErr error
	for i, prompt := range prompts {
		card, err := c.callAndParse(ctx, searchModel, prompt, searchPrefill, searchMaxTokens, ParseWordInfo)
		if err != nil {
			lastErr = err
			slog.WarnContext(ctx, "search-word card attempt failed", "attempt", i+1, "err", err)
			continue
		}
		if verr := validateCard(card, targetCode, query, resolved); verr != nil {
			lastErr = verr
			slog.WarnContext(ctx, "search-word card validation failed", "attempt", i+1, "err", verr)
			continue
		}
		return card, nil
	}
	return domain.WordInfo{}, fmt.Errorf("could not build a clean %s dictionary card for %q: %w", targetCode, resolved.Word, lastErr)
}

// callAndParse performs one model call — retrying transient failures (network, 429, 5xx,
// truncated output) with backoff — and parses the JSON answer with parse.
func (c *Client) callAndParse(ctx context.Context, model, prompt, prefill string, maxTokens int,
	parse func(string) (domain.WordInfo, error)) (domain.WordInfo, error) {
	var lastErr error
	for attempt := 1; attempt <= searchAttempts; attempt++ {
		start := time.Now()
		text, err := c.completeWith(ctx, model, prompt, prefill, maxTokens, searchTimeout)
		slog.InfoContext(ctx, "search-word ai call", "model", model, "attempt", attempt, "took_ms", time.Since(start).Milliseconds(), "ok", err == nil)
		if err == nil {
			info, perr := parse(text)
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
		if attempt == searchAttempts {
			break
		}
		select {
		case <-ctx.Done():
			return domain.WordInfo{}, ctx.Err()
		case <-time.After(searchBackoff):
		}
	}
	return domain.WordInfo{}, lastErr
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

// unmarshalWordJSON extracts and JSON-decodes a WordInfo-shaped answer (fences/extra text
// tolerated, broken quotes repaired). It does not validate which fields are required —
// callers do that, since the resolve and card steps require different fields.
func unmarshalWordJSON(s string) (domain.WordInfo, error) {
	s = extractJSONObject(s)
	var w domain.WordInfo
	if err := json.Unmarshal([]byte(s), &w); err != nil {
		if err2 := json.Unmarshal([]byte(repairJSONStrings(s)), &w); err2 != nil {
			return domain.WordInfo{}, fmt.Errorf("parse word json: %w", err)
		}
	}
	return w, nil
}

// normalizeWordInfo trims fields and fixes common model mistakes (article leaked into "word",
// duplicate/empty alternatives, stray null markers), shared by the resolve and card steps.
func normalizeWordInfo(w domain.WordInfo) domain.WordInfo {
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
	return w
}

// ParseWordInfo extracts and normalises a full dictionary-card answer (the assembleCard step).
func ParseWordInfo(s string) (domain.WordInfo, error) {
	w, err := unmarshalWordJSON(s)
	if err != nil {
		return domain.WordInfo{}, err
	}
	w = normalizeWordInfo(w)
	if w.Word == "" || w.Translation == "" {
		return domain.WordInfo{}, errors.New("word or translation is empty")
	}
	return w, nil
}

// parseResolution extracts and normalises the smaller resolveWord answer (no translation yet).
func parseResolution(s string) (domain.WordInfo, error) {
	w, err := unmarshalWordJSON(s)
	if err != nil {
		return domain.WordInfo{}, err
	}
	w = normalizeWordInfo(w)
	if w.Word == "" || w.QueryLanguage == "" {
		return domain.WordInfo{}, errors.New("word or query_language is empty")
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
