package anthropic

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"

	"learnwords/internal/domain"
)

// Offline: the prompt must name both languages and the native-first rules.
func TestBuildSearchPrompt_NativeFirst(t *testing.T) {
	p := buildSearchPrompt("de", "uz", "men")
	for _, want := range []string{
		`Query: "men"`,
		"native_language: Uzbek",
		"learning_language: German",
		"BY MEANING",
		"NEVER choose a German word because it is spelled similarly",
		`"men" → ich (not der Mensch)`,
		`"translation" and "example_translation" MUST be in Uzbek`,
		"simple Latin letters",
	} {
		if !strings.Contains(p, want) {
			t.Errorf("prompt missing %q", want)
		}
	}
	if strings.Contains(p, "{{") {
		t.Errorf("prompt has unreplaced placeholder:\n%s", p)
	}
	if !strings.Contains(buildSearchPrompt("de", "ru", "тетрадь"), "Russian Cyrillic letters") {
		t.Error("ru native should ask for Cyrillic pronunciation")
	}
	if !strings.Contains(buildSearchPrompt("de", "xx", "q"), "native_language: Russian") {
		t.Error("unknown native language must fall back to Russian")
	}
}

// Offline: parser keeps alternatives/query_language, drops duplicates of the main word.
func TestParseWordInfo_Alternatives(t *testing.T) {
	w, err := ParseWordInfo(`{"word":"Heft","word_type":"noun","article":"das","translation":"daftar",
		"alternatives":["das Heft","das Notizbuch"," die  Kladde ","","das Notizbuch"],"query_language":" UZ "}`)
	if err != nil {
		t.Fatal(err)
	}
	if got := strings.Join(w.Alternatives, "|"); got != "das Notizbuch|die Kladde" {
		t.Errorf("alternatives = %q", got)
	}
	if w.QueryLanguage != "uz" {
		t.Errorf("query_language = %q", w.QueryLanguage)
	}
}

// Live (calls the real API): run with
//
//	ANTHROPIC_API_KEY=... go test ./internal/provider/anthropic -run Live -v
func TestLookupWord_Live_UzToDe(t *testing.T) {
	key := os.Getenv("ANTHROPIC_API_KEY")
	if key == "" {
		t.Skip("ANTHROPIC_API_KEY not set")
	}
	c := New(key, "")
	cases := []struct {
		native, query, want string
		wantTranslation     string // substring, lower-case; "" = don't check
	}{
		{"uz", "men", "ich", ""},
		{"uz", "daftar", "das Heft", ""},
		{"uz", "kitob", "das Buch", ""},
		{"uz", "olma", "der Apfel", ""},
		{"uz", "uy", "das Haus", ""},
		{"uz", "ich", "ich", "men"},
		{"ru", "тетрадь", "das Heft", ""},
		{"en", "notebook", "das Heft", ""},
	}
	for _, tc := range cases {
		t.Run(tc.native+"/"+tc.query, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
			defer cancel()
			ctx = domain.WithTranslationLang(domain.WithLang(ctx, "de"), tc.native)
			w, err := c.LookupWord(ctx, tc.query)
			if err != nil {
				t.Fatal(err)
			}
			full := w.FullWord()
			ok := strings.EqualFold(full, tc.want)
			for _, a := range w.Alternatives { // "das Notizbuch" etc. as main is acceptable if Heft is an alternative
				ok = ok || (tc.want == "das Heft" && strings.EqualFold(a, tc.want))
			}
			if !ok {
				t.Errorf("%q → %q (alts %v), want %q", tc.query, full, w.Alternatives, tc.want)
			}
			if tc.wantTranslation != "" && !strings.Contains(strings.ToLower(w.Translation), tc.wantTranslation) {
				t.Errorf("translation = %q, want it to contain %q", w.Translation, tc.wantTranslation)
			}
			if w.TranslationLanguage != tc.native {
				t.Errorf("translation_language = %q", w.TranslationLanguage)
			}
		})
	}
}
