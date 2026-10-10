// hero_phrases.go: every piece of text the "German hero" feature can say, in one place so it's
// easy to edit without touching the orchestration logic in hero.go. No AI involved — these are
// fixed templates filled in with a word the user has actually learned.
package service

import (
	"fmt"
	"strings"
	"unicode"
)

// heroStagePhrases: one template per stage (index = stage-1). {{Wort}} is the chosen noun
// (capitalized, no article); {{def}}/{{indef}} are its accusative definite/indefinite article.
// Stage 6 ("Adult") has no noun slot — it's a fixed sentence.
var heroStagePhrases = [6]string{
	"{{Wort}}!",
	"Ich will {{def}} {{Wort}}.",
	"Ich habe {{indef}} {{Wort}}.",
	"Heute sehe ich {{def}} {{Wort}}.",
	"Ich möchte {{indef}} {{Wort}} kaufen.",
	"Ich möchte in Deutschland arbeiten und leben.",
}

// heroFallbackPhrases are used when the user has no learned noun with a known, non-plural
// gender yet — one per stage, same order as heroStagePhrases.
var heroFallbackPhrases = [6]string{
	"Wasser!",
	"Ich will Wasser.",
	"Ich habe einen Hund.",
	"Heute gehe ich in die Schule.",
	"Am Wochenende treffe ich meine Freunde.",
	"Ich möchte in Deutschland arbeiten und leben.",
}

// heroGrowthPhrase is said instead of the stage phrase right after the hero reaches a new stage.
const heroGrowthPhrase = "Ich bin gewachsen!"

// heroBirthdayPhrase is said instead of the stage phrase on the anniversary of the account's
// creation date (see isHeroBirthday).
func heroBirthdayPhrase(years int) string {
	if years == 1 {
		return "Heute wirst du ein Jahr alt!"
	}
	return fmt.Sprintf("Heute wirst du %d Jahre alt!", years)
}

// German accusative articles, keyed by the nominative article stored on the word.
var germanDefiniteAccusative = map[string]string{"der": "den", "die": "die", "das": "das"}
var germanIndefiniteAccusative = map[string]string{"der": "einen", "die": "eine", "das": "ein"}

// pluralOnlyGermanNouns: common nouns with no singular form, so a stored "die X" for one of
// these is never mistaken for a feminine singular (there is no per-word plural flag to check).
var pluralOnlyGermanNouns = map[string]bool{
	"leute": true, "eltern": true, "ferien": true, "geschwister": true,
}

// parseGenderedGermanNoun parses a stored word like "der Hund" into (article, noun).
// ok=false if there is no recognised der/die/das prefix, or the noun is plural-only — the
// gender (and therefore the word) is then skipped entirely, never guessed.
func parseGenderedGermanNoun(word string) (article, noun string, ok bool) {
	fields := strings.Fields(word)
	if len(fields) < 2 {
		return "", "", false
	}
	a := strings.ToLower(fields[0])
	if a != "der" && a != "die" && a != "das" {
		return "", "", false
	}
	noun = strings.Join(fields[1:], " ")
	if pluralOnlyGermanNouns[strings.ToLower(noun)] {
		return "", "", false
	}
	return a, noun, true
}

// capitalizeFirst uppercases the first rune: German nouns are always capitalized, but a word
// could be stored lowercase (e.g. typed that way by the user).
func capitalizeFirst(s string) string {
	r := []rune(s)
	if len(r) == 0 {
		return s
	}
	r[0] = unicode.ToUpper(r[0])
	return string(r)
}

// heroPhrase builds stage's phrase from a learned, gendered, non-plural noun picked out of
// learnedWords via pick(n) (0 <= pick(n) < n — injected so tests can make it deterministic;
// production passes rand.Intn). Falls back to heroFallbackPhrases[stage-1] when no learned word
// qualifies, or for stage 6 which never needs a noun.
func heroPhrase(stage int, learnedWords []string, pick func(n int) int) string {
	idx := stage - 1
	if idx < 0 {
		idx = 0
	} else if idx > 5 {
		idx = 5
	}
	if idx == 5 { // fixed sentence, no noun slot
		return heroStagePhrases[5]
	}

	type candidate struct{ article, noun string }
	var candidates []candidate
	for _, w := range learnedWords {
		if a, n, ok := parseGenderedGermanNoun(w); ok {
			candidates = append(candidates, candidate{a, n})
		}
	}
	if len(candidates) == 0 {
		return heroFallbackPhrases[idx]
	}
	c := candidates[pick(len(candidates))]
	phrase := heroStagePhrases[idx]
	phrase = strings.ReplaceAll(phrase, "{{Wort}}", capitalizeFirst(c.noun))
	phrase = strings.ReplaceAll(phrase, "{{def}}", germanDefiniteAccusative[c.article])
	phrase = strings.ReplaceAll(phrase, "{{indef}}", germanIndefiniteAccusative[c.article])
	return phrase
}

// heroStageNames: the six stage names per interface language. Falls back to Russian for an
// unrecognised language, same as domain.NormTranslationLang elsewhere.
var heroStageNames = map[string][6]string{
	"ru": {"Младенец", "Малыш", "Дошкольник", "Школьник", "Подросток", "Взрослый"},
	"en": {"Newborn", "Toddler", "Preschooler", "Schoolchild", "Teenager", "Adult"},
	"uz": {"Chaqaloq", "Goʻdak", "Bogʻcha bolasi", "Maktab oʻquvchisi", "Oʻsmir", "Voyaga yetgan"},
}

// heroStageName returns stage's name (1-6) in lang (ru/en/uz; anything else falls back to ru).
func heroStageName(stage int, lang string) string {
	names, ok := heroStageNames[lang]
	if !ok {
		names = heroStageNames["ru"]
	}
	idx := stage - 1
	if idx < 0 {
		idx = 0
	} else if idx > 5 {
		idx = 5
	}
	return names[idx]
}
