package anthropic

import (
	"strings"
	"testing"

	"learnwords/internal/domain"
)

// Offline: the prompt names both languages and the word, and omits example-sentence text when none is given.
func TestBuildTranslatePrompt(t *testing.T) {
	p := buildTranslatePrompt(domain.TranslateRequest{LearningLang: "de", NativeLang: "uz", Word: "du", ExampleSentence: "Du bist nett."}, false)
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

	noExample := buildTranslatePrompt(domain.TranslateRequest{LearningLang: "de", NativeLang: "ru", Word: "ich"}, false)
	if !strings.Contains(noExample, "No example sentence.") {
		t.Error("empty example sentence should fall back to a plain note")
	}

	reinforced := buildTranslatePrompt(domain.TranslateRequest{LearningLang: "de", NativeLang: "uz", Word: "du"}, true)
	if !strings.Contains(reinforced, "IMPORTANT") {
		t.Error("reinforced prompt must call out the previous mistake")
	}
}

// The prompt carries the card's known meaning and says the word is German, so a homograph
// ("still" = quiet) is not translated as the English word ("ещё").
func TestBuildTranslatePrompt_KnownMeaningHint(t *testing.T) {
	p := buildTranslatePrompt(domain.TranslateRequest{
		LearningLang: "de", NativeLang: "uz", Word: "still", ExampleSentence: "Das Kind ist still.",
		KnownMeaning: "тихий, спокойный", KnownMeaningLang: "ru",
	}, false)
	for _, want := range []string{
		`Known meaning in Russian: "тихий, спокойный"`,
		"This is a German word (not English).",
		"Translate exactly this meaning.",
		`Example sentence: "Das Kind ist still."`,
	} {
		if !strings.Contains(p, want) {
			t.Errorf("prompt missing %q\n%s", want, p)
		}
	}
	if strings.Contains(p, "___") || strings.Contains(p, "{{") {
		t.Errorf("gap or placeholder left in the prompt:\n%s", p)
	}

	// Language of the meaning unknown → the hint still names the meaning.
	if p := buildTranslatePrompt(domain.TranslateRequest{LearningLang: "de", NativeLang: "en", Word: "still", KnownMeaning: "quiet"}, false); !strings.Contains(p, `Known meaning: "quiet"`) {
		t.Errorf("no-language hint:\n%s", p)
	}
	// No known meaning → no hint about it; an English learner is not told "(not English)".
	if p := buildTranslatePrompt(domain.TranslateRequest{LearningLang: "de", NativeLang: "ru", Word: "ich"}, false); strings.Contains(p, "Known meaning") || strings.Contains(p, "Translate exactly") {
		t.Errorf("hint without a meaning:\n%s", p)
	}
	if p := buildTranslatePrompt(domain.TranslateRequest{LearningLang: "en", NativeLang: "ru", Word: "still"}, false); strings.Contains(p, "not English") {
		t.Errorf("English learner:\n%s", p)
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
