package anthropic

import "testing"

func TestParseExample(t *testing.T) {
	raw := "```json\n{\"sentence_with_gap\":\"Ich esse eine ___.\",\"full_sentence\":\"Ich esse eine Birne.\",\"translation\":\"Я ем грушу.\"}\n```"
	ex, err := ParseExample(raw)
	if err != nil || ex.SentenceWithGap != "Ich esse eine ___." || ex.Translation != "Я ем грушу." {
		t.Fatalf("got %+v, %v", ex, err)
	}
	if _, err := ParseExample("not json"); err == nil {
		t.Fatal("expected error")
	}
}
