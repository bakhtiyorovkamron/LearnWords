package starter

import (
	"strings"
	"testing"
)

func TestContent_FourLanguagesFifteenPhrasesEachWellFormed(t *testing.T) {
	c, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	for _, lang := range []string{"de", "en", "fr", "ko"} {
		ps := c.Phrases(lang)
		if len(ps) != 15 {
			t.Fatalf("%s: %d phrases, want 15", lang, len(ps))
		}
		seen := map[string]bool{}
		for i, p := range ps {
			if strings.TrimSpace(p.Word) == "" {
				t.Errorf("%s #%d: empty word", lang, i)
			}
			if seen[p.Word] {
				t.Errorf("%s: %q twice", lang, p.Word)
			}
			seen[p.Word] = true
			if n := strings.Count(p.Example, "___"); n != 1 {
				t.Errorf("%s %q: example has %d blanks: %q", lang, p.Word, n, p.Example)
			}
			for _, native := range []string{"ru", "en", "uz"} {
				if strings.TrimSpace(p.Translation[native]) == "" {
					t.Errorf("%s %q: no %s translation", lang, p.Word, native)
				}
				if strings.TrimSpace(p.ExampleTranslation[native]) == "" {
					t.Errorf("%s %q: no %s example translation", lang, p.Word, native)
				}
			}
			if lang == "ko" && strings.TrimSpace(p.Transcription) == "" {
				t.Errorf("ko %q: no transcription", p.Word)
			}
			if lang != "ko" && p.Transcription != "" {
				t.Errorf("%s %q: unexpected transcription %q", lang, p.Word, p.Transcription)
			}
		}
	}
	if len(c.Languages) != 4 {
		t.Errorf("%d languages in the file, want 4", len(c.Languages))
	}
	for _, native := range []string{"ru", "en", "uz"} {
		if c.FolderName(native) == "" {
			t.Errorf("no folder name in %s", native)
		}
	}
	if c.Folder.Color == "" {
		t.Error("no folder colour")
	}
}

func TestContent_FirstGermanPhraseAndFallback(t *testing.T) {
	c, _ := Load()
	p := c.Phrases("de")[0]
	if p.Word != "Hallo!" || p.TranslationIn("uz") != "Salom!" || p.Example != "___ Ich heiße Anna." {
		t.Errorf("%+v", p)
	}
	if c.FolderName("uz") != "Tanishuv" || c.FolderName("en") != "Introductions" {
		t.Errorf("folder names: %q %q", c.FolderName("uz"), c.FolderName("en"))
	}
	if c.FolderName("xx") != c.FolderName("ru") || p.TranslationIn("") != p.TranslationIn("ru") {
		t.Error("an unknown language must fall back to Russian")
	}
	if c.Phrases("xx") != nil {
		t.Error("unknown learning language must have no phrases")
	}
}
