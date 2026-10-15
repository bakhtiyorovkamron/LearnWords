// word_check.go: checks a German word/phrase the user is about to save — typos, base form,
// article, plural. Only parses the answer; the contract is validated in domain.NormalizeWordCheck
// (the service retries once and falls back to "error").
package anthropic

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"learnwords/internal/domain"
)

const wordCheckPrompt = `You check a German word or phrase that a learner wants to save to their vocabulary.
Input: "{{input}}"
The learner's native language is {{native}}.

Rules:
1) Typo or misspelling → status "corrected" with the correctly spelled word (e.g. "Sfit" → "Stift").
2) An inflected form of a single word (conjugated verb, plural or declined noun, declined adjective) → status "corrected", "lemma" = the base form: nouns in nominative singular, verbs in the infinitive, adjectives in the base form (e.g. "komme" → "kommen", "Häuser" → "Haus").
3) A phrase or expression of several words (e.g. "Bis nächste Woche!") is NEVER reduced to a base form: "lemma" is the phrase itself, only spelling mistakes fixed, punctuation kept; part_of_speech "phrase".
4) Nouns: "article" is the correct article of the singular (der/die/das) — also when the input has no article or a wrong one; "plural" is the nominative plural without article, or null if the noun has no plural. Nouns are always capitalized. For every other part of speech "article" and "plural" are null.
5) Wrong capitalization alone is a mistake too (phones capitalize the first letter): "Langsam" → "langsam" (adverb), "tisch" → "Tisch" (noun) — status "corrected" with the correctly capitalized word. Verbs, adjectives and adverbs are lower case, nouns upper case.
5b) A word that is already correct and in its base form (an input noun may lack the article) → status "ok", "lemma" = the input word without article.
6) Something that is not German and cannot be corrected to a German word → status "unknown", other fields null/empty.
7) "translation": short {{native}} translation (1-4 words) of the lemma — no parentheses, no comments.
8) "reason": empty for "ok"; otherwise a very short explanation in {{native}} (e.g. "typo", "not the base form", "wrong article").

Return ONLY this JSON:
{"status":"ok|corrected|unknown","input":"{{input}}","lemma":"","article":null,"plural":null,"part_of_speech":"noun|verb|adjective|adverb|phrase|other","translation":"","reason":""}`

func buildWordCheckPrompt(input, native string) string {
	return strings.NewReplacer(
		"{{input}}", clean(input),
		"{{native}}", domain.TranslationLangName(native),
	).Replace(wordCheckPrompt)
}

const (
	wordCheckMaxTokens = 300
	wordCheckTimeout   = 20 * time.Second
)

// CheckWord makes one model call and returns the parsed (not yet validated) answer.
func (c *Client) CheckWord(ctx context.Context, input, nativeLang string) (domain.WordCheck, error) {
	text, err := c.completeWith(ctx, c.model, buildWordCheckPrompt(input, nativeLang), searchPrefill,
		wordCheckMaxTokens, wordCheckTimeout)
	if err != nil {
		return domain.WordCheck{}, err
	}
	return parseWordCheck(text)
}

func parseWordCheck(s string) (domain.WordCheck, error) {
	var w domain.WordCheck
	if err := json.Unmarshal([]byte(extractJSONObject(s)), &w); err != nil {
		return domain.WordCheck{}, fmt.Errorf("parse word check json: %w", err)
	}
	return w, nil
}
