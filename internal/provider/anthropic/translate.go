// translate.go: on-demand translation of an already-known word (and its example sentence)
// into a given native/interface language — used to show quiz questions in the user's actual
// interface language instead of whatever language the card happened to be created in.
package anthropic

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"

	"learnwords/internal/domain"
)

const translateCardPrompt = `Translate the {{target}} word "{{word}}"{{exampleNote}} into {{native}}.
{{hint}}
"translation" MUST contain ONLY the short {{native}} equivalent (1-4 words) — NO parentheses, NO grammatical comments, NO language names, nothing but the bare translation.
"example_translation" is the plain {{native}} translation of the example sentence below (empty string "" if there is none), with the same rule: no parentheses or comments mixed in.
{{exampleBlock}}
Return ONLY this JSON:
{"translation":"","example_translation":""}`

const reinforceTranslate = `
IMPORTANT: your previous answer put an explanation in "translation" or "example_translation" (parentheses, a grammar comment, a language name). Return a clean, bare translation this time.`

// translateHint tells the model which sense of the word is meant: the card's own translation.
// Without it a homograph goes wrong ("still" = quiet, not the English "still"/"ещё").
func translateHint(req domain.TranslateRequest) string {
	learning := domain.Lang(req.LearningLang)
	var b strings.Builder
	if m := clean(req.KnownMeaning); m != "" {
		if req.KnownMeaningLang != "" {
			fmt.Fprintf(&b, "Known meaning in %s: %q\n", domain.TranslationLangName(req.KnownMeaningLang), m)
		} else {
			fmt.Fprintf(&b, "Known meaning: %q\n", m)
		}
	}
	notEnglish := ""
	if learning.Code != "en" {
		notEnglish = " (not English)"
	}
	fmt.Fprintf(&b, "This is a %s word%s.", learning.NameEN, notEnglish)
	if clean(req.KnownMeaning) != "" {
		b.WriteString(" Translate exactly this meaning.")
	}
	return b.String()
}

func buildTranslatePrompt(req domain.TranslateRequest, reinforce bool) string {
	learning := domain.Lang(req.LearningLang)
	native := domain.NormTranslationLang(req.NativeLang)
	word, exampleSentence := req.Word, req.ExampleSentence
	exampleNote, exampleBlock := "", "No example sentence."
	if s := clean(exampleSentence); s != "" {
		exampleNote = " (used in the example sentence below)"
		exampleBlock = fmt.Sprintf("Example sentence: %q", s)
	}
	p := strings.NewReplacer(
		"{{word}}", clean(word),
		"{{target}}", learning.NameEN,
		"{{hint}}", translateHint(req),
		"{{native}}", domain.TranslationLangName(native),
		"{{exampleNote}}", exampleNote,
		"{{exampleBlock}}", exampleBlock,
	).Replace(translateCardPrompt)
	if reinforce {
		p += strings.NewReplacer("{{native}}", domain.TranslationLangName(native)).Replace(reinforceTranslate)
	}
	return p
}

func validateTranslation(translation, exampleTranslation string) error {
	if translation == "" {
		return fmt.Errorf("translation is empty")
	}
	if strings.ContainsAny(translation, "()") {
		return fmt.Errorf("translation contains an explanation: %q", translation)
	}
	if strings.ContainsAny(exampleTranslation, "()") {
		return fmt.Errorf("example_translation contains an explanation: %q", exampleTranslation)
	}
	return nil
}

type translationResult struct {
	Translation        string `json:"translation"`
	ExampleTranslation string `json:"example_translation"`
}

func parseTranslation(s string) (translationResult, error) {
	s = extractJSONObject(s)
	var out translationResult
	if err := json.Unmarshal([]byte(s), &out); err != nil {
		if err2 := json.Unmarshal([]byte(repairJSONStrings(s)), &out); err2 != nil {
			return translationResult{}, fmt.Errorf("parse translation json: %w", err)
		}
	}
	out.Translation = strings.TrimSpace(out.Translation)
	out.ExampleTranslation = strings.TrimSpace(out.ExampleTranslation)
	return out, nil
}

// TranslateCard translates an already-identified learning-language word (and, if given, the
// example sentence it's used in) into nativeLang. Two attempts: a validation failure (an
// explanation leaking into the translation, same bug class as the search endpoint) is retried
// once with a reinforced prompt before giving up.
func (c *Client) TranslateCard(ctx context.Context, req domain.TranslateRequest) (translation, exampleTranslation string, err error) {
	prompts := []string{
		buildTranslatePrompt(req, false),
		buildTranslatePrompt(req, true),
	}
	var lastErr error
	for i, prompt := range prompts {
		text, cerr := c.completeWith(ctx, searchModel, prompt, searchPrefill, searchResolveMaxTokens, searchTimeout)
		if cerr != nil {
			lastErr = cerr
			slog.WarnContext(ctx, "translate-card attempt failed", "attempt", i+1, "err", cerr)
			continue
		}
		res, perr := parseTranslation(text)
		if perr != nil {
			lastErr = perr
			slog.ErrorContext(ctx, "translate-card: invalid model output", "err", perr, "raw", text)
			continue
		}
		if verr := validateTranslation(res.Translation, res.ExampleTranslation); verr != nil {
			lastErr = verr
			slog.WarnContext(ctx, "translate-card validation failed", "attempt", i+1, "err", verr)
			continue
		}
		return res.Translation, res.ExampleTranslation, nil
	}
	return "", "", fmt.Errorf("could not translate %q into %s: %w", req.Word, req.NativeLang, lastErr)
}
