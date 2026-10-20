// translate_story.go: translates an already-generated story (and a gloss per word used in it)
// into a given native/interface language — lazily, once per (story, language), on first view.
package anthropic

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"learnwords/internal/domain"
)

const storyTranslatePrompt = `Translate the following {{target}} story into {{native}}.

Story:
"""
{{story}}
"""
{{glossBlock}}
Return ONLY this JSON:
{{jsonShape}}
"translation" is the plain {{native}} translation of the whole story, preserving paragraph
breaks as \n (escaped). Do not translate the **bold** markers — keep them around the same words.`

// glossBlockTpl is left out entirely when there are no words to gloss (own stories have no word list).
const glossBlockTpl = `
Also give a short gloss (1-4 words, no parentheses or grammatical comments) in {{native}} for
each of these {{target}} words, exactly as spelled below — one entry per word, using that exact
spelling as the JSON key:
{{words}}
`

const reinforceStoryTranslateNoWords = `
IMPORTANT: your previous answer left "translation" empty or was not valid JSON. Return the complete translation of the whole story this time.`

const reinforceStoryTranslate = `
IMPORTANT: your previous answer was missing a gloss for one or more of the listed words, or left "translation" empty. Return a complete answer this time, with exactly one gloss per listed word.`

func buildStoryTranslatePrompt(learningLang, nativeLang, storyDE string, words []string, reinforce bool) string {
	target := domain.Lang(learningLang).NameEN
	native := domain.NormTranslationLang(nativeLang)
	nativeName := domain.TranslationLangName(native)

	glossBlock, jsonShape := "", `{"translation":"...","word_glosses":{}}`
	if len(words) > 0 {
		var b strings.Builder
		for _, w := range words {
			fmt.Fprintf(&b, "- %s\n", clean(w))
		}
		glossBlock = strings.NewReplacer(
			"{{target}}", target, "{{native}}", nativeName, "{{words}}", strings.TrimRight(b.String(), "\n"),
		).Replace(glossBlockTpl)
		jsonShape = `{"translation":"...","word_glosses":{"<word>":"..."}}`
	}
	p := strings.NewReplacer(
		"{{glossBlock}}", glossBlock,
		"{{jsonShape}}", jsonShape,
		"{{target}}", target,
		"{{native}}", nativeName,
		"{{story}}", storyDE,
	).Replace(storyTranslatePrompt)
	if reinforce {
		if len(words) > 0 {
			p += reinforceStoryTranslate
		} else {
			p += reinforceStoryTranslateNoWords
		}
	}
	return p
}

type storyTranslationResult struct {
	Translation string            `json:"translation"`
	WordGlosses map[string]string `json:"word_glosses"`
}

func parseStoryTranslation(s string) (storyTranslationResult, error) {
	s = extractJSONObject(s)
	var out storyTranslationResult
	if err := json.Unmarshal([]byte(s), &out); err != nil {
		if err2 := json.Unmarshal([]byte(repairJSONStrings(s)), &out); err2 != nil {
			return storyTranslationResult{}, fmt.Errorf("parse story translation json: %w", err)
		}
	}
	out.Translation = strings.TrimSpace(out.Translation)
	return out, nil
}

// validateStoryTranslation requires a non-empty translation and exactly one non-empty gloss
// per requested word (case-insensitive key match — the model sometimes changes case).
func validateStoryTranslation(res storyTranslationResult, words []string) error {
	if res.Translation == "" {
		return fmt.Errorf("translation is empty")
	}
	lower := make(map[string]string, len(res.WordGlosses))
	for k, v := range res.WordGlosses {
		lower[strings.ToLower(strings.TrimSpace(k))] = strings.TrimSpace(v)
	}
	for _, w := range words {
		g, ok := lower[strings.ToLower(strings.TrimSpace(w))]
		if !ok || g == "" {
			return fmt.Errorf("missing gloss for %q", w)
		}
	}
	return nil
}

// storyTranslateMaxTokens: translated text is roughly the size of the source plus a small
// per-word gloss map. A 4000-character own story must fit (cap 4096).
func storyTranslateMaxTokens(storyDE string, words int) int {
	n := len(storyDE)*3/4 + 100*words + 500
	if n > 4096 {
		n = 4096
	}
	if n < 800 {
		n = 800
	}
	return n
}

// TranslateStory translates storyDE into nativeLang and glosses each of words. Two attempts: a
// validation failure (empty translation, a missing gloss) is retried once with a reinforced
// prompt before giving up — an incomplete result is never returned, so it is never cached or
// shown to the user half-done.
func (c *Client) TranslateStory(ctx context.Context, learningLang, nativeLang, storyDE string, words []string) (string, map[string]string, error) {
	maxTokens := storyTranslateMaxTokens(storyDE, len(words))
	prompts := []string{
		buildStoryTranslatePrompt(learningLang, nativeLang, storyDE, words, false),
		buildStoryTranslatePrompt(learningLang, nativeLang, storyDE, words, true),
	}
	const storyTranslateTimeout = 90 * time.Second // longer text than a single search query

	var lastErr error
	for i, prompt := range prompts {
		text, err := c.completeWith(ctx, searchModel, prompt, searchPrefill, maxTokens, storyTranslateTimeout)
		if err != nil {
			lastErr = err
			slog.WarnContext(ctx, "story translate attempt failed", "attempt", i+1, "err", err)
			continue
		}
		res, perr := parseStoryTranslation(text)
		if perr != nil {
			lastErr = perr
			slog.ErrorContext(ctx, "story translate: invalid model output", "err", perr, "raw", text)
			continue
		}
		if verr := validateStoryTranslation(res, words); verr != nil {
			lastErr = verr
			slog.WarnContext(ctx, "story translate validation failed", "attempt", i+1, "err", verr)
			continue
		}
		return res.Translation, res.WordGlosses, nil
	}
	return "", nil, fmt.Errorf("could not translate story into %s: %w", nativeLang, lastErr)
}
