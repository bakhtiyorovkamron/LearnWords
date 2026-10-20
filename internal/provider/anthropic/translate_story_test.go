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

// An own story has no word list: no gloss part in the prompt, "word_glosses": {} expected, and an
// answer without glosses is valid.
func TestBuildStoryTranslatePrompt_NoWords(t *testing.T) {
	for _, words := range [][]string{nil, {}} {
		p := buildStoryTranslatePrompt("de", "ru", "Der Hund läuft.\nDie Sonne scheint.", words, false)
		for _, banned := range []string{"Also give", "short gloss", "one entry per word", "exact spelling", "<word>", "\n- "} {
			if strings.Contains(p, banned) {
				t.Errorf("prompt without words contains %q:\n%s", banned, p)
			}
		}
		for _, want := range []string{
			"Translate the following German story into Russian",
			"Der Hund läuft.\nDie Sonne scheint.",
			`{"translation":"...","word_glosses":{}}`,
			"preserving paragraph",
		} {
			if !strings.Contains(p, want) {
				t.Errorf("prompt missing %q\n%s", want, p)
			}
		}
		if strings.Contains(p, "{{") {
			t.Errorf("unreplaced placeholder:\n%s", p)
		}
	}
	// The retry hint must not talk about glosses either.
	if r := buildStoryTranslatePrompt("de", "ru", "x", nil, true); !strings.Contains(r, "IMPORTANT") || strings.Contains(r, "missing a gloss") {
		t.Errorf("reinforced prompt without words:\n%s", r)
	}
	// With words the prompt is what it was.
	if p := buildStoryTranslatePrompt("de", "ru", "x", []string{"Hund"}, false); !strings.Contains(p, "- Hund") || !strings.Contains(p, `"<word>"`) {
		t.Errorf("prompt with words lost its gloss part:\n%s", p)
	}
}

func TestValidateStoryTranslation_NoWords(t *testing.T) {
	if err := validateStoryTranslation(storyTranslationResult{Translation: "Собака бежит."}, nil); err != nil {
		t.Errorf("a translation without glosses must pass when no words were asked: %v", err)
	}
	if err := validateStoryTranslation(storyTranslationResult{Translation: "x", WordGlosses: map[string]string{}}, []string{}); err != nil {
		t.Errorf("empty gloss map: %v", err)
	}
	if err := validateStoryTranslation(storyTranslationResult{}, nil); err == nil {
		t.Error("an empty translation must still fail")
	}
}

// A 4000-character story fits; the cap is 4096; the floor stays.
func TestStoryTranslateMaxTokens(t *testing.T) {
	cases := []struct {
		text  string
		words int
		want  int
	}{
		{strings.Repeat("a", 4000), 0, 3500},  // 4000*3/4 + 500
		{strings.Repeat("a", 6000), 0, 4096},  // capped
		{strings.Repeat("a", 4000), 12, 4096}, // 3000+1200+500 → capped
		{"kurz", 0, 800},                      // floor
		{strings.Repeat("a", 800), 3, 1400},   // 600+300+500
	}
	for _, c := range cases {
		if got := storyTranslateMaxTokens(c.text, c.words); got != c.want {
			t.Errorf("%d chars, %d words → %d, want %d", len(c.text), c.words, got, c.want)
		}
	}
}
