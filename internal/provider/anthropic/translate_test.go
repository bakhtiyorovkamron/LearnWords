package anthropic

import (
	"strings"
	"testing"
)

// Offline: the prompt names both languages and the word, and omits example-sentence text when none is given.
func TestBuildTranslatePrompt(t *testing.T) {
	p := buildTranslatePrompt("de", "uz", "du", "Du bist nett.", false)
	for _, want := range []string{
		`Translate the German word "du"`,
		"into Uzbek",
		`Example sentence: "Du bist nett."`,
		"NO parentheses, NO grammatical comments",
	} {
		if !strings.Contains(p, want) {
			t.Errorf("prompt missing %q\n%s", want, p)
		}
	}
	if strings.Contains(p, "{{") {
		t.Errorf("prompt has unreplaced placeholder:\n%s", p)
	}

	noExample := buildTranslatePrompt("de", "ru", "ich", "", false)
	if !strings.Contains(noExample, "No example sentence.") {
		t.Error("empty example sentence should fall back to a plain note")
	}

	reinforced := buildTranslatePrompt("de", "uz", "du", "", true)
	if !strings.Contains(reinforced, "IMPORTANT") {
		t.Error("reinforced prompt must call out the previous mistake")
	}
}

// Offline: parser trims whitespace and tolerates markdown fences.
func TestParseTranslation(t *testing.T) {
	res, err := parseTranslation("```json\n{\"translation\":\" sen \",\"example_translation\":\" Sen yaxshisan. \"}\n```")
	if err != nil {
		t.Fatal(err)
	}
	if res.Translation != "sen" || res.ExampleTranslation != "Sen yaxshisan." {
		t.Errorf("got %+v", res)
	}
}

// Offline: this is the same bug class as the search endpoint — an explanation leaking into the
// bare translation field instead of staying out of it entirely.
func TestValidateTranslation(t *testing.T) {
	if err := validateTranslation("", ""); err == nil {
		t.Error("expected error: empty translation")
	}
	if err := validateTranslation("sen (informal pronoun)", ""); err == nil {
		t.Error("expected error: explanation in translation")
	}
	if err := validateTranslation("sen", "Sen yaxshisan (do'stona)."); err == nil {
		t.Error("expected error: explanation in example_translation")
	}
	if err := validateTranslation("sen", "Sen yaxshisan."); err != nil {
		t.Errorf("valid translation rejected: %v", err)
	}
}
