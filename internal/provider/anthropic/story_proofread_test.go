package anthropic

import (
	"strings"
	"testing"

	"learnwords/internal/domain"
)

func TestStoryPromptUsesLemmaAndAllowsInflection(t *testing.T) {
	words := []domain.StoryWord{
		{Word: "Sfit", Lemma: "Stift", Article: "der", PartOfSpeech: "noun"}, // accepted correction
		{Word: "komme", Lemma: "kommen", PartOfSpeech: "verb"},
		{Word: "Geld"}, // unchecked word: sent as saved
	}
	p := buildStoryPrompt("de", words, "сказка", false)
	for _, want := range []string{"- der Stift\n", "- kommen\n", "- Geld", `"kommen" → "Sie kommt"`, "Do NOT paste them in as listed"} {
		if !strings.Contains(p, want) {
			t.Errorf("story prompt is missing %q", want)
		}
	}
	for _, raw := range []string{"Sfit", "komme\n"} {
		if strings.Contains(p, raw) {
			t.Errorf("story prompt contains the raw saved text %q", raw)
		}
	}
}

func TestProofreadPromptAndParse(t *testing.T) {
	p := buildStoryProofreadPrompt("de", "Die magische Stift", "**Sie komme** heute.", []domain.StoryWord{{Word: "komme", Lemma: "kommen"}})
	for _, want := range []string{"Title: Die magische Stift", "**Sie komme** heute.", "- kommen", "do NOT remove any of these words", `"word_forms"`} {
		if !strings.Contains(p, want) {
			t.Errorf("proofread prompt is missing %q", want)
		}
	}
	out, err := parseProofread(`{"title":"Der magische Stift","text":"Sie **kommt** heute.","corrections":[{"from":"Sie komme","to":"Sie kommt","why":"agreement"}],"word_forms":{"kommen":["kommt"]}}`)
	if err != nil {
		t.Fatal(err)
	}
	if out.Title != "Der magische Stift" || len(out.Corrections) != 1 || out.WordForms["kommen"][0] != "kommt" {
		t.Fatalf("got %+v", out)
	}
}
