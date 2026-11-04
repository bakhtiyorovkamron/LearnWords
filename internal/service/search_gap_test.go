package service

import "testing"

func TestGapExample_ReturnsWhatItCutOut(t *testing.T) {
	cases := []struct{ sentence, word, wantSentence, wantAnswer string }{
		{"Ich esse einen Apfel.", "der Apfel", "Ich esse einen ___.", "Apfel"},
		{"Die Katze schläft.", "Katze", "Die ___ schläft.", "Katze"},
		{"Die Suppe schmeckt gut.", "schmecken", "Die Suppe schmeckt gut.", ""}, // inflected: not found literally
		{"Sei ___!", "still", "Sei ___!", ""},                                   // already has a gap
	}
	for _, c := range cases {
		gotS, gotA := gapExample(c.sentence, c.word)
		if gotS != c.wantSentence || gotA != c.wantAnswer {
			t.Errorf("gapExample(%q, %q) = %q, %q; want %q, %q", c.sentence, c.word, gotS, gotA, c.wantSentence, c.wantAnswer)
		}
	}
}
