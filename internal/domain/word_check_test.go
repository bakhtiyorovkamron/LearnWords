package domain

import (
	"errors"
	"testing"
)

func sp(s string) *string { return &s }

func TestNormalizeWordCheck(t *testing.T) {
	cases := []struct {
		name        string
		input       string
		raw         WordCheck
		wantStatus  string
		wantLemma   string
		wantArticle string // "" = nil
		wantPlural  string // "" = nil
		wantPos     string
		wantSuggest string
	}{
		{
			name: "typo Sfit → der Stift", input: "Sfit",
			raw:        WordCheck{Status: "corrected", Lemma: "Stift", Article: sp("der"), Plural: sp("Stifte"), PartOfSpeech: "noun", Translation: "ручка", Reason: "опечатка"},
			wantStatus: CheckCorrected, wantLemma: "Stift", wantArticle: "der", wantPlural: "Stifte", wantPos: PosNoun, wantSuggest: "der Stift",
		},
		{
			name: "verb form komme → kommen", input: "komme",
			raw:        WordCheck{Status: "corrected", Lemma: "kommen", PartOfSpeech: "verb", Translation: "приходить", Reason: "не начальная форма"},
			wantStatus: CheckCorrected, wantLemma: "kommen", wantPos: PosVerb, wantSuggest: "kommen",
		},
		{
			name: "plural Häuser → das Haus", input: "Häuser",
			raw:        WordCheck{Status: "corrected", Lemma: "Haus", Article: sp("das"), Plural: sp("Häuser"), PartOfSpeech: "noun", Translation: "дом"},
			wantStatus: CheckCorrected, wantLemma: "Haus", wantArticle: "das", wantPlural: "Häuser", wantPos: PosNoun, wantSuggest: "das Haus",
		},
		{
			name: "das Geld is ok", input: "das Geld",
			raw:        WordCheck{Status: "ok", Lemma: "Geld", Article: sp("das"), PartOfSpeech: "noun", Translation: "деньги"},
			wantStatus: CheckOK, wantLemma: "Geld", wantArticle: "das", wantPos: PosNoun, wantSuggest: "das Geld",
		},
		{
			name: "phrase is kept as typed", input: "Bis nächste Woche!",
			raw:        WordCheck{Status: "ok", Lemma: "Bis nächste Woche!", PartOfSpeech: "phrase", Translation: "до следующей недели"},
			wantStatus: CheckOK, wantLemma: "Bis nächste Woche!", wantPos: PosPhrase, wantSuggest: "Bis nächste Woche!",
		},
		{
			name: "phrase: dropped final punctuation is not a correction", input: "Bis nächste Woche!",
			raw:        WordCheck{Status: "corrected", Lemma: "Bis nächste Woche", PartOfSpeech: "phrase", Translation: "до следующей недели"},
			wantStatus: CheckOK, wantLemma: "Bis nächste Woche", wantPos: PosPhrase, wantSuggest: "Bis nächste Woche",
		},
		{
			name: "Tisch without article is ok, article der", input: "Tisch",
			raw:        WordCheck{Status: "corrected", Lemma: "Tisch", Article: sp("der"), Plural: sp("Tische"), PartOfSpeech: "noun", Translation: "стол", Reason: "нет артикля"},
			wantStatus: CheckOK, wantLemma: "Tisch", wantArticle: "der", wantPlural: "Tische", wantPos: PosNoun, wantSuggest: "der Tisch",
		},
		{
			name: "wrong article is a correction even if the model says ok", input: "die Tisch",
			raw:        WordCheck{Status: "ok", Lemma: "Tisch", Article: sp("der"), PartOfSpeech: "noun", Translation: "стол"},
			wantStatus: CheckCorrected, wantLemma: "Tisch", wantArticle: "der", wantPos: PosNoun, wantSuggest: "der Tisch",
		},
		{
			name: "lower-case noun gets capitalized → correction", input: "tisch",
			raw:        WordCheck{Status: "ok", Lemma: "tisch", Article: sp("Der"), PartOfSpeech: "noun", Translation: "стол"},
			wantStatus: CheckCorrected, wantLemma: "Tisch", wantArticle: "der", wantPos: PosNoun, wantSuggest: "der Tisch",
		},
		{
			name: "article inside lemma and plural are split off", input: "Stift",
			raw:        WordCheck{Status: "ok", Lemma: "der Stift", Plural: sp("die Stifte"), PartOfSpeech: "noun", Translation: "ручка"},
			wantStatus: CheckOK, wantLemma: "Stift", wantArticle: "der", wantPlural: "Stifte", wantPos: PosNoun, wantSuggest: "der Stift",
		},
		{
			name: "non-nouns never carry article/plural", input: "schnell",
			raw:        WordCheck{Status: "ok", Lemma: "schnell", Article: sp("der"), Plural: sp("x"), PartOfSpeech: "adjective", Translation: "быстрый"},
			wantStatus: CheckOK, wantLemma: "schnell", wantPos: PosAdjective, wantSuggest: "schnell",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := NormalizeWordCheck(tc.raw, tc.input)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got.Status != tc.wantStatus || got.Lemma != tc.wantLemma || got.PartOfSpeech != tc.wantPos {
				t.Fatalf("got status=%s lemma=%q pos=%s", got.Status, got.Lemma, got.PartOfSpeech)
			}
			if deref(got.Article) != tc.wantArticle || deref(got.Plural) != tc.wantPlural {
				t.Fatalf("got article=%q plural=%q", deref(got.Article), deref(got.Plural))
			}
			if got.Suggestion() != tc.wantSuggest {
				t.Fatalf("suggestion = %q, want %q", got.Suggestion(), tc.wantSuggest)
			}
			if got.Input != tc.input {
				t.Fatalf("input = %q", got.Input)
			}
		})
	}
}

func TestNormalizeWordCheck_Unknown(t *testing.T) {
	got, err := NormalizeWordCheck(WordCheck{Status: "unknown", Lemma: "xyz", Article: sp("der")}, "Qwrtz")
	if err != nil || got.Status != CheckUnknown || got.Lemma != "" || got.Article != nil || got.Grammar() != nil {
		t.Fatalf("got %+v, %v", got, err)
	}
}

func TestNormalizeWordCheck_Invalid(t *testing.T) {
	bad := []WordCheck{
		{Status: "maybe", Lemma: "Stift", PartOfSpeech: "noun", Article: sp("der"), Translation: "ручка"},
		{Status: "ok", Lemma: "", PartOfSpeech: "verb", Translation: "x"},
		{Status: "ok", Lemma: "Stift", PartOfSpeech: "noun", Translation: "ручка"},                      // noun without article
		{Status: "ok", Lemma: "Stift", PartOfSpeech: "noun", Article: sp("le"), Translation: "ручка"},   // not a German article
		{Status: "ok", Lemma: "Stift", PartOfSpeech: "thing", Article: sp("der"), Translation: "ручка"}, // bad part of speech
		{Status: "ok", Lemma: "kommen", PartOfSpeech: "verb"},                                           // no translation
	}
	for i, raw := range bad {
		if _, err := NormalizeWordCheck(raw, "Stift"); !errors.Is(err, ErrInvalidWordCheck) {
			t.Errorf("case %d: want ErrInvalidWordCheck, got %v", i, err)
		}
	}
}

func deref(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}
