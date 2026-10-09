package anthropic

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"

	"learnwords/internal/domain"
)

// Offline: the resolve prompt must name both languages, the native-first rules, and the
// pronoun hints that the production bug was about (short Uzbek function words copied as-is).
func strPtr(s string) *string { return &s }

func TestBuildResolvePrompt_NativeFirst(t *testing.T) {
	p := buildResolvePrompt("de", "uz", "sen", false)
	for _, want := range []string{
		`Query: "sen"`,
		"native_language: Uzbek",
		"learning_language: German",
		"BY MEANING",
		"never copied as-is",
		`"sen"→"du"`,
	} {
		if !strings.Contains(p, want) {
			t.Errorf("prompt missing %q\n%s", want, p)
		}
	}
	if strings.Contains(p, "{{") {
		t.Errorf("prompt has unreplaced placeholder:\n%s", p)
	}
	if !strings.Contains(buildResolvePrompt("de", "xx", "q", false), "native_language: Russian") {
		t.Error("unknown native language must fall back to Russian")
	}

	card := buildCardPrompt("de", "ru", domain.WordInfo{Word: "Heft", Article: strPtr("das")}, false)
	if !strings.Contains(card, `"translation" and "example_translation" MUST be written in Russian`) {
		t.Errorf("card prompt missing native-language translation rule:\n%s", card)
	}
	if !strings.Contains(card, "Russian Cyrillic letters") {
		t.Error("ru native should ask for Cyrillic pronunciation")
	}
	if !strings.Contains(buildCardPrompt("de", "uz", domain.WordInfo{Word: "Heft"}, false), "simple Latin letters") {
		t.Error("uz native should ask for Latin pronunciation")
	}
	if reinforced := buildResolvePrompt("de", "uz", "sen", true); !strings.Contains(reinforced, "IMPORTANT") {
		t.Error("reinforced prompt must call out the previous mistake")
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

// Offline: parseResolution requires word + query_language, not translation (it runs before the card step).
func TestParseResolution(t *testing.T) {
	w, err := parseResolution(`{"word":"du","article":null,"alternatives":[],"query_language":"uz"}`)
	if err != nil || w.Word != "du" || w.QueryLanguage != "uz" {
		t.Fatalf("got %+v, %v", w, err)
	}
	if _, err := parseResolution(`{"word":"","article":null,"alternatives":[],"query_language":"uz"}`); err == nil {
		t.Error("expected error for empty word")
	}
}

// Offline: this is the exact production bug — the native query returned unchanged as "word" —
// and the explanation text that leaked into "alternatives" ("du (sen - ... in German)").
func TestValidateResolution_RejectsUntranslatedQuery(t *testing.T) {
	bug := domain.WordInfo{Word: "sen", QueryLanguage: "uz"}
	if err := validateResolution(bug, "de", "sen"); err == nil {
		t.Error("expected error: word equals the native query verbatim")
	}
	fixed := domain.WordInfo{Word: "du", QueryLanguage: "uz"}
	if err := validateResolution(fixed, "de", "sen"); err != nil {
		t.Errorf("valid resolution rejected: %v", err)
	}
	// Legitimate case: the query really is the target-language word (query_language == target).
	same := domain.WordInfo{Word: "ich", QueryLanguage: "de"}
	if err := validateResolution(same, "de", "ich"); err != nil {
		t.Errorf("target-language query wrongly rejected: %v", err)
	}
	withExplanation := domain.WordInfo{Word: "du", QueryLanguage: "uz",
		Alternatives: []string{"du (sen - 2nd person singular informal pronoun in German)"}}
	if err := validateResolution(withExplanation, "de", "sen"); err == nil {
		t.Error("expected error: alternative contains an explanation")
	}
}

// Offline: an example sentence must be clean target-language text, not a parenthetical note
// or (when the query is native-language) the native sentence returned unchanged.
func TestValidateCard(t *testing.T) {
	resolved := domain.WordInfo{Word: "du", QueryLanguage: "uz"}
	if err := validateCard(domain.WordInfo{ExampleSentence: "Du bist nett (sen yaxshisan)."}, "de", "sen", resolved); err == nil {
		t.Error("expected error: parenthetical note in example_sentence")
	}
	if err := validateCard(domain.WordInfo{ExampleSentence: "Sen juda yaxshisan."}, "de", "sen", resolved); err == nil {
		t.Error("expected error: example_sentence is still in the native language")
	}
	if err := validateCard(domain.WordInfo{ExampleSentence: "Du bist nett."}, "de", "sen", resolved); err != nil {
		t.Errorf("valid card rejected: %v", err)
	}
}

// Live (calls the real API): run with
//
//	ANTHROPIC_API_KEY=... go test ./internal/provider/anthropic -run Live -v
//
// Covers the production bug report: short Uzbek personal pronouns (sen, u, biz, siz, men) must
// resolve to their German equivalent, never be returned unchanged.
func TestLookupWord_Live_UzToDe(t *testing.T) {
	key := os.Getenv("ANTHROPIC_API_KEY")
	if key == "" {
		t.Skip("ANTHROPIC_API_KEY not set")
	}
	c := New(key, "")
	cases := []struct {
		native, query, want string
		wantTranslation      string // substring, lower-case; "" = don't check
	}{
		{"uz", "sen", "du", "sen"},
		{"uz", "men", "ich", "men"},
		{"uz", "u", "er", "u"}, // "sie"/"es" also acceptable, checked below
		{"uz", "biz", "wir", "biz"},
		{"uz", "siz", "ihr", "siz"}, // "Sie" also acceptable
		{"uz", "daftar", "das Heft", "daftar"},
		{"uz", "kitob", "das Buch", "kitob"},
		{"uz", "olma", "der Apfel", "olma"},
		{"uz", "uy", "das Haus", "uy"},
		{"uz", "ich", "ich", "men"},
		{"uz", "Haus", "das Haus", "uy"},
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
			// Pronouns and formal/informal forms have more than one correct German answer.
			for _, alt := range []string{"er", "sie", "es", "ihr", "sie"} {
				ok = ok || ((tc.want == "er" || tc.want == "ihr") && strings.EqualFold(full, alt))
			}
			for _, a := range w.Alternatives { // "das Notizbuch" etc. as main is acceptable if Heft is an alternative
				ok = ok || (tc.want == "das Heft" && strings.EqualFold(a, tc.want))
			}
			if !ok {
				t.Errorf("%q → %q (alts %v), want %q", tc.query, full, w.Alternatives, tc.want)
			}
			// The exact bug: the native query must never come back unchanged as the word.
			if !strings.EqualFold(tc.query, tc.want) && strings.EqualFold(full, tc.query) {
				t.Errorf("%q → %q: native query returned unchanged", tc.query, full)
			}
			if tc.wantTranslation != "" && !strings.Contains(strings.ToLower(w.Translation), tc.wantTranslation) {
				t.Errorf("translation = %q, want it to contain %q", w.Translation, tc.wantTranslation)
			}
			if w.TranslationLanguage != tc.native {
				t.Errorf("translation_language = %q", w.TranslationLanguage)
			}
			for _, ch := range []string{"(", ")"} {
				if strings.Contains(w.ExampleSentence, ch) || strings.ContainsAny(strings.Join(w.Alternatives, ""), ch) {
					t.Errorf("example_sentence/alternatives contain an explanation: %q, %v", w.ExampleSentence, w.Alternatives)
				}
			}
		})
	}
}
