package anthropic

import (
	"strings"
	"testing"
)

func TestBuildWordCheckPrompt(t *testing.T) {
	p := buildWordCheckPrompt(`Sfit"`, "ru")
	for _, want := range []string{`Input: "Sfit"`, "Russian", `"komme" → "kommen"`, "NEVER reduced to a base form", "der/die/das"} {
		if !strings.Contains(p, want) {
			t.Errorf("prompt is missing %q", want)
		}
	}
}

func TestParseWordCheck(t *testing.T) {
	w, err := parseWordCheck("```json\n" + `{"status":"corrected","input":"Sfit","lemma":"Stift","article":"der","plural":"Stifte","part_of_speech":"noun","translation":"ручка","reason":"опечатка"}` + "\n```")
	if err != nil {
		t.Fatal(err)
	}
	if w.Status != "corrected" || w.Lemma != "Stift" || w.Article == nil || *w.Article != "der" || *w.Plural != "Stifte" {
		t.Fatalf("got %+v", w)
	}
	if _, err := parseWordCheck("not json"); err == nil {
		t.Fatal("want error for invalid JSON")
	}
}
