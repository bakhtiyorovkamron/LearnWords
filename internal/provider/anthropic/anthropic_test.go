package anthropic

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"unicode"

	"learnwords/internal/domain"
)

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
		"clean":      `{"title":"T","story_de":"Hallo **Welt**."}`,
		"fenced":     "```json\n{\"title\":\"T\",\"story_de\":\"Hallo.\"}\n```",
		"stray text": "Hier ist die Geschichte:\n{\"title\":\"T\",\"story_de\":\"Hallo.\"}\nViel Spaß!",
		// The bug from production: unescaped quotes in dialogue → "invalid character 'A' after object key:value pair".
		"inner quotes": `{"title":"T","story_de":"Er sagte: "Anna, komm!" Dann ging er."}`,
		"raw newline":  "{\"title\":\"T\",\"story_de\":\"Zeile 1\nZeile 2\"}",
	}
	for name, raw := range cases {
		st, err := ParseStory(raw)
		if err != nil || st.StoryDE == "" {
			t.Errorf("%s: got %+v, %v", name, st, err)
		}
	}
	if st, _ := ParseStory(`{"title":"T","story_de":"Er sagte: "Anna, komm!" Dann."}`); st.StoryDE != `Er sagte: "Anna, komm!" Dann.` {
		t.Errorf("inner quotes not preserved: %q", st.StoryDE)
	}
	// Truncated JSON (max_tokens) must fail so the caller retries.
	if _, err := ParseStory(`{"title":"T","story_de":"Hallo, das ist ein lang`); err == nil {
		t.Error("expected error for truncated JSON")
	}
}

func TestExamplePrompt_TranslationInTheInterfaceLanguage(t *testing.T) {
	for native, want := range map[string]string{"uz": "Uzbek (Latin script)", "en": "English", "ru": "Russian"} {
		p := buildPrompt("de", native, "der Tisch", "table") // Latin data: any Cyrillic left is the instruction
		if !strings.Contains(p, "translation of the full sentence in "+want) {
			t.Errorf("%s: prompt does not ask for %s:\n%s", native, want, p)
		}
		for _, r := range p {
			if unicode.Is(unicode.Cyrillic, r) && native != "ru" {
				t.Errorf("%s: a Russian/Cyrillic instruction is left in the prompt: %q", native, r)
				break
			}
		}
	}
	// The user's own word and translation are data and are passed through.
	if p := buildPrompt("de", "uz", "der Tisch", "stol"); !strings.Contains(p, `"der Tisch"`) || !strings.Contains(p, `"stol"`) {
		t.Errorf("word or translation missing:\n%s", p)
	}
}

func TestExamplePrompt_NamesTheLearningLanguageAndTheGapRule(t *testing.T) {
	p := buildPrompt("fr", "en", "la table", "table")
	for _, want := range []string{"in French", `"den Tisch" for "der Tisch"`, "article included", "three underscores"} {
		if !strings.Contains(p, want) {
			t.Errorf("prompt lacks %q", want)
		}
	}
	if strings.Contains(p, "{{") {
		t.Error("unreplaced placeholder")
	}
}

// The request really carries the user's language: Generate reads it from the context.
func TestGenerate_UsesTheContextsTranslationLanguage(t *testing.T) {
	var sent string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		sent = string(raw)
		_ = json.NewEncoder(w).Encode(map[string]any{"content": []map[string]string{{"type": "text",
			"text": `{"sentence_with_gap":"Ich sehe ___.","full_sentence":"Ich sehe den Tisch.","translation":"Men stolni ko‘ryapman."}`}}})
	}))
	defer srv.Close()
	old := endpoint
	endpoint = srv.URL
	defer func() { endpoint = old }()

	ctx := domain.WithTranslationLang(domain.WithLang(context.Background(), "de"), "uz")
	ex, err := New("k", "").Generate(ctx, "der Tisch", "stol")
	if err != nil || ex.Translation != "Men stolni ko‘ryapman." {
		t.Fatalf("%+v %v", ex, err)
	}
	if !strings.Contains(sent, "Uzbek (Latin script)") {
		t.Errorf("the request does not ask for Uzbek: %s", sent)
	}
}
