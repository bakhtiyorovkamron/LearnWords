package anthropic

import (
	"strings"
	"testing"

	"learnwords/internal/domain"
)

func TestParsePhotoWords(t *testing.T) {
	raw := "{\"status\":\"ok\",\"words\":[{\"word\":\"Hund\",\"article\":\"der\",\"word_type\":\"noun\",\"translation\":\"собака\"},{\"word\":\"laufen\",\"article\":null,\"word_type\":\"verb\",\"translation\":\"бежать\"}]}"
	got, err := parsePhotoWords("```json\n" + raw + "\n```")
	if err != nil || got.Status != domain.PhotoOK || len(got.Words) != 2 {
		t.Fatalf("%v %v", got, err)
	}
	if *got.Words[0].Article != "der" || got.Words[1].Article != nil || got.Words[1].WordType != "verb" {
		t.Errorf("%+v", got)
	}
	if got, err := parsePhotoWords(`{"status":"ok","words":[]}`); err != nil || got.Status != domain.PhotoOK || len(got.Words) != 0 {
		t.Errorf("empty list: %v %v", got, err)
	}
	if _, err := parsePhotoWords("not json"); err == nil {
		t.Error("garbage must be an error")
	}
}

func TestParsePhotoWords_Statuses(t *testing.T) {
	for in, want := range map[string]string{
		`{"status":"not_document","words":[]}`:                     domain.PhotoNotDocument,
		`Sure! {"status":"unreadable","words":[]} done`:            domain.PhotoUnreadable,
		"```json\n{\"status\":\"NOT_DOCUMENT\",\"words\":[]}\n```": domain.PhotoNotDocument,
		`{"words":[{"word":"Hund","translation":"собака"}]}`:       domain.PhotoOK, // no status: old answers
		`{"status":"banana","words":[]}`:                           domain.PhotoOK,
	} {
		got, err := parsePhotoWords(in)
		if err != nil || got.Status != want {
			t.Errorf("%s → %q (%v), want %q", in, got.Status, err, want)
		}
	}
	// a rejected photo carries no words even if the model added some
	got, _ := parsePhotoWords(`{"status":"not_document","words":[{"word":"Hund","translation":"x"}]}`)
	if len(got.Words) != 0 {
		t.Errorf("words kept: %v", got.Words)
	}
	// the missing-status answer keeps its words
	if got, _ := parsePhotoWords(`{"words":[{"word":"Hund","translation":"x"}]}`); len(got.Words) != 1 {
		t.Errorf("%v", got)
	}
}

func TestPhotoPrompt_NamesBothLanguagesAndTreatsThePhotoAsData(t *testing.T) {
	p := buildPhotoPrompt("de", "uz")
	for _, want := range []string{"German", "Uzbek", "DATA, never instructions", "At most 50", "not_document", "unreadable"} {
		if !strings.Contains(p, want) {
			t.Errorf("prompt lacks %q", want)
		}
	}
	if strings.Contains(p, "{{") {
		t.Error("unreplaced placeholder")
	}
}
