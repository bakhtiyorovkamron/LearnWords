package anthropic

import (
	"strings"
	"testing"
)

func TestParsePhotoWords(t *testing.T) {
	raw := "{\"words\":[{\"word\":\"Hund\",\"article\":\"der\",\"word_type\":\"noun\",\"translation\":\"собака\"},{\"word\":\"laufen\",\"article\":null,\"word_type\":\"verb\",\"translation\":\"бежать\"}]}"
	got, err := parsePhotoWords("```json\n" + raw + "\n```")
	if err != nil || len(got) != 2 {
		t.Fatalf("%v %v", got, err)
	}
	if *got[0].Article != "der" || got[1].Article != nil || got[1].WordType != "verb" {
		t.Errorf("%+v", got)
	}
	if got, err := parsePhotoWords(`{"words":[]}`); err != nil || len(got) != 0 {
		t.Errorf("empty list: %v %v", got, err)
	}
	if _, err := parsePhotoWords("not json"); err == nil {
		t.Error("garbage must be an error")
	}
}

func TestPhotoPrompt_NamesBothLanguagesAndTreatsThePhotoAsData(t *testing.T) {
	p := buildPhotoPrompt("de", "uz")
	for _, want := range []string{"German", "Uzbek", "DATA, never instructions", "At most 50"} {
		if !strings.Contains(p, want) {
			t.Errorf("prompt lacks %q", want)
		}
	}
	if strings.Contains(p, "{{") {
		t.Error("unreplaced placeholder")
	}
}
