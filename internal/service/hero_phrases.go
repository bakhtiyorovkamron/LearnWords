// hero_phrases.go: every piece of text the "German hero" can say, in one place so it's easy to
// edit without touching the orchestration logic in hero.go. No AI involved — fixed templates
// filled in with a noun the user has actually learned, or the stage's own ready phrases.
package service

import (
	"fmt"
	"strings"
	"unicode"

	"learnwords/internal/domain"
)

// heroTemplate is one stage's sentence pattern. German placeholders:
//
//	{{Wort}}  the noun (capitalized, singular, no article)
//	{{nom}}   definite article, nominative — capitalized as {{Nom}} at the start of a sentence
//	{{acc}}   definite article, accusative
//	{{iacc}}  indefinite article, accusative
//
// Translations keep the noun in its dictionary (nominative) form, so the user's own
// translation can be inserted as is in every language: {{w}}, or {{W}} capitalized,
// {{a}} = English "a"/"an".
type heroTemplate struct {
	de string
	tr map[string]string // ru | en | uz
}

// One template per stage (index = stage-1); each stage's sentence is a little longer.
var heroTemplates = [6]heroTemplate{
	{"{{Nom}} {{Wort}}!", map[string]string{"ru": "{{W}}!", "en": "The {{w}}!", "uz": "{{W}}!"}},
	{"Wo ist {{nom}} {{Wort}}?", map[string]string{"ru": "Где {{w}}?", "en": "Where is the {{w}}?", "uz": "{{W}} qayerda?"}},
	{"Ich habe {{iacc}} {{Wort}}.", map[string]string{"ru": "У меня есть {{w}}.", "en": "I have {{a}} {{w}}.", "uz": "Menda {{w}} bor."}},
	{"Mir gefällt {{nom}} {{Wort}} sehr.", map[string]string{"ru": "Мне очень нравится {{w}}.", "en": "I really like the {{w}}.", "uz": "{{W}} menga juda yoqadi."}},
	{"Kannst du mir bitte {{acc}} {{Wort}} zeigen?", map[string]string{"ru": "Покажешь мне, где {{w}}?", "en": "Can you show me the {{w}}, please?", "uz": "{{W}} qayerdaligini koʻrsatib berasanmi?"}},
	{"Ohne {{acc}} {{Wort}} kann ich nicht leben.", map[string]string{"ru": "{{W}} — без этого я жить не могу.", "en": "I can't live without the {{w}}.", "uz": "{{W}} — usiz yashay olmayman."}},
}

// heroStageSay: each stage's own ready phrases (the same as in docs/hero-prototype.html and
// frontend/src/lib/heroStages.ts). Used when the user has no suitable learned noun yet.
var heroStageSay = [6][]heroLine{
	{{"Musik!", "Музыка!", "Music!", "Musiqa!"}, {"Bravo!", "Браво!", "Bravo!", "Barakalla!"}, {"Noch mal!", "Ещё раз!", "Once more!", "Yana bir marta!"}},
	{{"Es war einmal…", "Жили-были…", "Once upon a time…", "Bir bor ekan…"}, {"Ich mag Märchen.", "Я люблю сказки.", "I like fairy tales.", "Men ertaklarni yaxshi koʻraman."}},
	{{"Ich schreibe ein Gedicht.", "Я пишу стихотворение.", "I'm writing a poem.", "Men sheʼr yozyapman."}, {"Freude!", "Радость!", "Joy!", "Quvonch!"}},
	{{"Ich höre Musik in meinem Kopf.", "Я слышу музыку в голове.", "I hear music in my head.", "Boshimda musiqa eshitaman."}, {"Noch einmal, bitte!", "Ещё раз, пожалуйста!", "Once more, please!", "Yana bir marta, iltimos!"}},
	{{"Kannst du mir bitte den Weg zeigen?", "Покажешь мне дорогу?", "Can you show me the way, please?", "Menga yoʻlni koʻrsatib bera olasanmi?"}, {"Ich reise gern um die Welt.", "Я люблю путешествовать по миру.", "I love travelling around the world.", "Men dunyo boʻylab sayohat qilishni yaxshi koʻraman."}},
	{{"Ich habe es geschafft!", "У меня получилось!", "I did it!", "Men uddaladim!"}, {"Mehr Licht!", "Больше света! (по легенде, последние слова Гёте)", "More light! (Goethe's last words, as legend has it)", "Koʻproq yorugʻlik! (rivoyatga koʻra, Gyotening soʻnggi soʻzlari)"}, {"Ich lese gern deutsche Bücher.", "Я люблю читать немецкие книги.", "I like reading German books.", "Men nemischa kitoblarni oʻqishni yaxshi koʻraman."}},
}

// heroLine is a ready phrase: German + ru/en/uz.
type heroLine struct{ de, ru, en, uz string }

func (l heroLine) phrase(lang string) domain.HeroPhrase {
	tr := l.ru
	switch lang {
	case "en":
		tr = l.en
	case "uz":
		tr = l.uz
	}
	return domain.HeroPhrase{De: l.de, Translation: tr}
}

// heroGrowthLine is said instead of the stage phrase while the hero's growth is not yet seen.
var heroGrowthLine = heroLine{"Ich bin gewachsen!", "Я вырос!", "I've grown up!", "Men ulgʻaydim!"}

// heroBirthdayLine: the anniversary of the account's creation date (see isHeroBirthday).
func heroBirthdayLine(years int) heroLine {
	if years == 1 {
		return heroLine{"Heute bin ich ein Jahr alt!", "Сегодня мне исполнился год!", "I'm one year old today!", "Bugun menga bir yosh toʻldi!"}
	}
	return heroLine{
		fmt.Sprintf("Heute bin ich %d Jahre alt!", years),
		fmt.Sprintf("Сегодня мне %d %s!", years, ruYears(years)),
		fmt.Sprintf("I'm %d years old today!", years),
		fmt.Sprintf("Bugun menga %d yosh toʻldi!", years),
	}
}

func ruYears(n int) string {
	switch {
	case n%10 == 1 && n%100 != 11:
		return "год"
	case n%10 >= 2 && n%10 <= 4 && (n%100 < 12 || n%100 > 14):
		return "года"
	default:
		return "лет"
	}
}

// German articles by case, keyed by the nominative article of the noun.
var (
	germanAccusative           = map[string]string{"der": "den", "die": "die", "das": "das"}
	germanIndefiniteAccusative = map[string]string{"der": "einen", "die": "eine", "das": "ein"}
)

// pluralOnlyGermanNouns: common nouns with no singular form, so a stored "die X" for one of
// these is never mistaken for a feminine singular.
var pluralOnlyGermanNouns = map[string]bool{
	"leute": true, "eltern": true, "ferien": true, "geschwister": true,
}

// heroNoun is a learned noun usable in a template: its gender is known for sure and it has a
// translation in the interface language.
type heroNoun struct{ article, noun, translation string }

// heroNounFrom returns ok=false for anything that isn't a singular noun with a known article
// and a usable translation — such words are skipped, never guessed.
func heroNounFrom(w domain.HeroWord) (heroNoun, bool) {
	if w.PartOfSpeech != "" && w.PartOfSpeech != domain.PosNoun {
		return heroNoun{}, false
	}
	if strings.Contains(w.Word, "/") {
		return heroNoun{}, false // "der Samstag / der Sonnabend"
	}
	article, noun := strings.ToLower(w.Article), w.Lemma
	if article == "" || noun == "" {
		a, rest := domain.SplitArticle(w.Word)
		if a == "" {
			return heroNoun{}, false
		}
		article, noun = a, rest
	}
	if !domain.IsGermanArticle(article) || strings.Contains(noun, " ") || pluralOnlyGermanNouns[strings.ToLower(noun)] {
		return heroNoun{}, false
	}
	tr := cleanHeroTranslation(w.Translation)
	if tr == "" {
		return heroNoun{}, false
	}
	return heroNoun{article: article, noun: capitalizeFirst(noun), translation: tr}, true
}

// cleanHeroTranslation keeps the first short meaning: "собака, пёс" → "собака", "a dog" → "dog".
func cleanHeroTranslation(s string) string {
	if i := strings.IndexAny(s, ",;/("); i >= 0 {
		s = s[:i]
	}
	s = strings.TrimSpace(s)
	for _, p := range []string{"a ", "an ", "the "} {
		if strings.HasPrefix(strings.ToLower(s), p) {
			s = strings.TrimSpace(s[len(p):])
		}
	}
	if s == "" || len(strings.Fields(s)) > 3 {
		return ""
	}
	return s
}

func capitalizeFirst(s string) string {
	r := []rune(s)
	if len(r) == 0 {
		return s
	}
	r[0] = unicode.ToUpper(r[0])
	return string(r)
}

// renderHeroTemplate fills stage's template (index 0-5) with n, in German and in lang.
func renderHeroTemplate(idx int, n heroNoun, lang string) domain.HeroPhrase {
	t := heroTemplates[idx]
	de := strings.NewReplacer(
		"{{Nom}}", capitalizeFirst(n.article),
		"{{nom}}", n.article,
		"{{acc}}", germanAccusative[n.article],
		"{{iacc}}", germanIndefiniteAccusative[n.article],
		"{{Wort}}", n.noun,
	).Replace(t.de)
	tr, ok := t.tr[lang]
	if !ok {
		tr = t.tr["ru"]
	}
	a := "a"
	if strings.ContainsRune("aeiouAEIOU", []rune(n.translation)[0]) {
		a = "an"
	}
	tr = strings.NewReplacer("{{W}}", capitalizeFirst(n.translation), "{{w}}", n.translation, "{{a}}", a).Replace(tr)
	return domain.HeroPhrase{De: de, Translation: tr}
}

// heroPhrase builds the stage's (1-6) phrase from one of the user's learned nouns, picked via
// pick(n) (0 <= pick(n) < n; injected so tests are deterministic, production uses rand.Intn).
// Only learned words ever fill the slot; with no suitable learned noun the stage's own ready
// phrase is used instead.
func heroPhrase(stage int, learned []domain.HeroWord, lang string, pick func(n int) int) domain.HeroPhrase {
	idx := min(max(stage-1, 0), 5)
	var nouns []heroNoun
	for _, w := range learned {
		if n, ok := heroNounFrom(w); ok {
			nouns = append(nouns, n)
		}
	}
	if len(nouns) == 0 {
		say := heroStageSay[idx]
		return say[pick(len(say))].phrase(lang)
	}
	return renderHeroTemplate(idx, nouns[pick(len(nouns))], lang)
}

// heroStageNames: the six stages — famous Germans from little Mozart to Goethe.
var heroStageNames = map[string][6]string{
	"ru": {"Маленький Моцарт", "Братья Гримм", "Шиллер", "Бетховен", "Гумбольдт", "Гёте"},
	"en": {"Little Mozart", "The Brothers Grimm", "Schiller", "Beethoven", "Humboldt", "Goethe"},
	"uz": {"Kichkina Motsart", "Aka-uka Grimmlar", "Shiller", "Betxoven", "Gumboldt", "Gyote"},
}

// heroStageName returns stage's name (1-6) in lang (ru/en/uz; anything else falls back to ru).
func heroStageName(stage int, lang string) string {
	names, ok := heroStageNames[lang]
	if !ok {
		names = heroStageNames["ru"]
	}
	return names[min(max(stage-1, 0), 5)]
}
