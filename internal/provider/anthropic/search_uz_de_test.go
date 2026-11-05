package anthropic

import (
	"strings"
	"testing"

	"learnwords/internal/domain"
)

// Offline regression for uz → de lookups. The live AI answer is not called here; instead we check
// that the prompt carries the required pairs and that the expected answers pass validation.
var uzDeCases = []struct {
	query   string
	word    string // expected German word (without article)
	article string // expected article, "" when none
}{
	{"men", "ich", ""},
	{"daftar", "Heft", "das"},
	{"kitob", "Buch", "das"},
	{"olma", "Apfel", "der"},
	{"uy", "Haus", "das"},
}

func TestUzDe_PromptContainsRequiredPairs(t *testing.T) {
	p := buildResolvePrompt("de", "uz", "men", false)
	for _, c := range uzDeCases {
		if c.word == "ich" {
			continue // "men"→"ich" is pinned by the explicit example below
		}
		want := `"` + c.query + `"→"`
		if !strings.Contains(resolveHints["uz"], want) {
			t.Errorf("uz hints missing pair for %q", c.query)
		}
	}
	for _, want := range []string{`"men"→"ich"`, `not "der Mensch"`, `"daftar"→"das Heft"`} {
		if !strings.Contains(resolveHints["uz"], want) {
			t.Errorf("uz hints missing %q", want)
		}
	}
	if !strings.Contains(p, "native_language: Uzbek") || !strings.Contains(p, "learning_language: German") {
		t.Errorf("prompt must name both languages:\n%s", p)
	}
}

func TestUzDe_ExpectedResolutionsPassValidation(t *testing.T) {
	for _, c := range uzDeCases {
		got := domain.WordInfo{Word: c.word, QueryLanguage: "uz"}
		if c.article != "" {
			art := c.article
			got.Article = &art
		}
		if err := validateResolution(got, "de", c.query); err != nil {
			t.Errorf("%q → %q rejected: %v", c.query, c.word, err)
		}
	}
}
