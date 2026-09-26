package service

import (
	"strings"
	"unicode"
)

var germanStopwords = map[string]struct{}{}

func init() {
	for _, w := range strings.Fields(`der die das den dem des ein eine einen einem einer eines
		und oder aber ich du er sie es wir ihr mich mir dich uns euch
		ist bin bist sind seid zu in im am an auf mit von vom für aus bei nach um
		nicht ja nein so auch noch nur schon da dann wenn als wie`) {
		germanStopwords[w] = struct{}{}
	}
}

// Tokenize splits text into unique meaningful words (order preserved, case-insensitive dedup).
// German nouns keep their capitalization. Phrase/lemma extraction can replace this later.
func Tokenize(text, lang string) []string {
	fields := strings.FieldsFunc(text, func(r rune) bool {
		return !unicode.IsLetter(r) && r != '-' && r != '\''
	})
	seen := make(map[string]struct{}, len(fields))
	out := make([]string, 0, len(fields))
	for _, f := range fields {
		f = strings.Trim(f, "-'")
		lower := strings.ToLower(f)
		if len([]rune(f)) < 2 {
			continue
		}
		if lang == "de" {
			if _, stop := germanStopwords[lower]; stop {
				continue
			}
		}
		if _, dup := seen[lower]; dup {
			continue
		}
		seen[lower] = struct{}{}
		out = append(out, f)
	}
	return out
}
