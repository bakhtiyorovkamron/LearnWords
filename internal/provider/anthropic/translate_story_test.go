package anthropic

import (
	"strings"
	"testing"
)

// Offline: the prompt names both languages, includes the story text and every word to gloss,
// and never leaks a {{placeholder}}.
func TestBuildStoryTranslatePrompt(t *testing.T) {
	p := buildStoryTranslatePrompt("de", "uz", "Der Hund **läuft**.", []string{"Hund", "laufen"}, false)
	for _, want := range []string{
		"Translate the following German story into Uzbek",
		"Der Hund **läuft**.",
		"- Hund",
		"- laufen",
		"one entry per word",
	} {
		if !strings.Contains(p, want) {
			t.Errorf("prompt missing %q\n%s", want, p)
		}
	}
	if strings.Contains(p, "{{") {
		t.Errorf("prompt has unreplaced placeholder:\n%s", p)
	}
	if reinforced := buildStoryTranslatePrompt("de", "uz", "x", nil, true); !strings.Contains(reinforced, "IMPORTANT") {
		t.Error("reinforced prompt must call out the previous mistake")
	}
}

// Offline: a translation must cover every requested word with a non-empty gloss; a missing or
// empty one is rejected (triggers the reinforced retry), case/whitespace in the key is forgiven.
func TestValidateStoryTranslation(t *testing.T) {
	words := []string{"Hund", "laufen"}
	if err := validateStoryTranslation(storyTranslationResult{Translation: ""}, words); err == nil {
		t.Error("expected error: empty translation")
	}
	missing := storyTranslationResult{Translation: "x", WordGlosses: map[string]string{"Hund": "it"}}
	if err := validateStoryTranslation(missing, words); err == nil {
		t.Error("expected error: missing gloss for 'laufen'")
	}
	empty := storyTranslationResult{Translation: "x", WordGlosses: map[string]string{"Hund": "it", "laufen": "  "}}
	if err := validateStoryTranslation(empty, words); err == nil {
		t.Error("expected error: empty gloss for 'laufen'")
	}
	ok := storyTranslationResult{Translation: "x", WordGlosses: map[string]string{" hund ": "it", "LAUFEN": "to run"}}
	if err := validateStoryTranslation(ok, words); err != nil {
		t.Errorf("valid translation rejected: %v", err)
	}
}

func TestParseStoryTranslation(t *testing.T) {
	res, err := parseStoryTranslation("```json\n{\"translation\":\" x \",\"word_glosses\":{\"Hund\":\"it\"}}\n```")
	if err != nil || res.Translation != "x" || res.WordGlosses["Hund"] != "it" {
		t.Fatalf("got %+v, %v", res, err)
	}
}
