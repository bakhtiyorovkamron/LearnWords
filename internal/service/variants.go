package service

import "strings"

// maxVariantWords limits how long one spelling variant may be ("der Samstag" = 2 words).
const maxVariantWords = 3

// SplitVariants detects input like "der Samstag / der Sonnabend" — one word with several
// equivalent spellings. It returns the trimmed variants, or nil if the text is not of that form
// (e.g. a normal phrase, or a sentence that happens to contain "/").
func SplitVariants(text string) []string {
	if !strings.Contains(text, "/") {
		return nil
	}
	var out []string
	for _, p := range strings.Split(text, "/") {
		p = strings.Join(strings.Fields(p), " ")
		if p == "" {
			continue
		}
		if len(strings.Fields(p)) > maxVariantWords {
			return nil
		}
		out = append(out, p)
	}
	if len(out) < 2 {
		return nil
	}
	return out
}
