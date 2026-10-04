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

func TestParseStory(t *testing.T) {
	cases := map[string]string{
		"clean":      `{"title":"T","story_de":"Hallo **Welt**.","story_ru":"Привет."}`,
		"fenced":     "```json\n{\"title\":\"T\",\"story_de\":\"Hallo.\",\"story_ru\":\"Привет.\"}\n```",
		"stray text": "Hier ist die Geschichte:\n{\"title\":\"T\",\"story_de\":\"Hallo.\",\"story_ru\":\"Привет.\"}\nViel Spaß!",
		// The bug from production: unescaped quotes in dialogue → "invalid character 'A' after object key:value pair".
		"inner quotes": `{"title":"T","story_de":"Er sagte: "Anna, komm!" Dann ging er.","story_ru":"Он сказал: "Анна!""}`,
		"raw newline":  "{\"title\":\"T\",\"story_de\":\"Zeile 1\nZeile 2\",\"story_ru\":\"Строка\"}",
	}
	for name, raw := range cases {
		st, err := ParseStory(raw)
		if err != nil || st.StoryDE == "" || st.StoryRU == "" {
			t.Errorf("%s: got %+v, %v", name, st, err)
		}
	}
	if st, _ := ParseStory(`{"title":"T","story_de":"Er sagte: "Anna, komm!" Dann.","story_ru":"x"}`); st.StoryDE != `Er sagte: "Anna, komm!" Dann.` {
		t.Errorf("inner quotes not preserved: %q", st.StoryDE)
	}
	// Truncated JSON (max_tokens) must fail so the caller retries.
	if _, err := ParseStory(`{"title":"T","story_de":"Hallo, das ist ein lang`); err == nil {
		t.Error("expected error for truncated JSON")
	}
}
