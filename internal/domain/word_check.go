package domain

import (
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode"

	"github.com/google/uuid"
)

// Word check statuses (POST /api/words/check).
const (
	CheckOK        = "ok"        // spelled correctly and already in its base form
	CheckCorrected = "corrected" // typo / inflected form / wrong article → a suggestion
	CheckUnknown   = "unknown"   // AI confidently answered: no such word and nothing sensible to suggest
	CheckError     = "error"     // the check itself failed (timeout, invalid answer) — says nothing about the word
)

// Parts of speech for word_cards.part_of_speech.
const (
	PosNoun      = "noun"
	PosVerb      = "verb"
	PosAdjective = "adjective"
	PosAdverb    = "adverb"
	PosPhrase    = "phrase"
	PosOther     = "other"
)

var partsOfSpeech = map[string]bool{
	PosNoun: true, PosVerb: true, PosAdjective: true, PosAdverb: true, PosPhrase: true, PosOther: true,
}

// IsPartOfSpeech reports whether s is one of the Pos* values.
func IsPartOfSpeech(s string) bool { return partsOfSpeech[s] }

var germanArticles = map[string]bool{"der": true, "die": true, "das": true}

// IsGermanArticle: der | die | das (lower case).
func IsGermanArticle(s string) bool { return germanArticles[s] }

// WordCheck is the validated result of checking one German word or phrase.
type WordCheck struct {
	Status       string  `json:"status"`
	Input        string  `json:"input"`
	Lemma        string  `json:"lemma"`   // base form: noun singular, verb infinitive; phrases spelled correctly
	Article      *string `json:"article"` // der | die | das, nouns only
	Plural       *string `json:"plural"`  // nouns only; nil if there is no plural
	PartOfSpeech string  `json:"part_of_speech"`
	Translation  string  `json:"translation"` // in the requested native language
	Reason       string  `json:"reason"`      // why it was corrected, in the native language
}

// Suggestion is how the word should be saved: "der Stift" for nouns, otherwise the lemma.
func (w WordCheck) Suggestion() string {
	if w.Article != nil && *w.Article != "" {
		return *w.Article + " " + w.Lemma
	}
	return w.Lemma
}

// WordGrammar is what a card stores next to the text the user typed.
type WordGrammar struct {
	Lemma        string
	Article      *string
	Plural       *string
	PartOfSpeech string
}

// Grammar of the checked word (nil for "unknown" and "error").
func (w WordCheck) Grammar() *WordGrammar {
	if w.Status == CheckUnknown || w.Status == CheckError || w.Lemma == "" {
		return nil
	}
	return &WordGrammar{Lemma: w.Lemma, Article: w.Article, Plural: w.Plural, PartOfSpeech: w.PartOfSpeech}
}

// Validate checks the grammar sent by a client together with a new word.
func (g *WordGrammar) Validate() error {
	if g == nil {
		return nil
	}
	g.Lemma = CollapseSpaces(g.Lemma)
	if g.Lemma == "" || len([]rune(g.Lemma)) > 100 {
		return fmt.Errorf("%w: lemma must be 1-100 characters", ErrValidation)
	}
	if !IsPartOfSpeech(g.PartOfSpeech) {
		return fmt.Errorf("%w: invalid part_of_speech", ErrValidation)
	}
	if g.PartOfSpeech != PosNoun {
		g.Article, g.Plural = nil, nil
	}
	g.Article = normNullable(g.Article)
	g.Plural = normNullable(g.Plural)
	if g.Article != nil {
		a := strings.ToLower(*g.Article)
		if !IsGermanArticle(a) {
			return fmt.Errorf("%w: article must be der, die or das", ErrValidation)
		}
		g.Article = &a
	}
	if g.Plural != nil && len([]rune(*g.Plural)) > 100 {
		return fmt.Errorf("%w: plural too long", ErrValidation)
	}
	return nil
}

// CollapseSpaces trims s and turns every run of whitespace into one space.
func CollapseSpaces(s string) string { return strings.Join(strings.Fields(s), " ") }

// SplitArticle: "das Geld" → ("das", "Geld"); "Geld" → ("", "Geld"). Case-insensitive article.
func SplitArticle(s string) (article, rest string) {
	s = CollapseSpaces(s)
	if f := strings.SplitN(s, " ", 2); len(f) == 2 && IsGermanArticle(strings.ToLower(f[0])) {
		return strings.ToLower(f[0]), f[1]
	}
	return "", s
}

func normNullable(p *string) *string {
	if p == nil {
		return nil
	}
	v := CollapseSpaces(*p)
	if v == "" || strings.EqualFold(v, "null") || v == "-" || v == "—" {
		return nil
	}
	return &v
}

// ErrInvalidWordCheck marks an AI answer that does not satisfy the response contract.
var ErrInvalidWordCheck = errors.New("invalid word check")

// NormalizeWordCheck validates a raw AI answer for input and makes it self-consistent. The
// server decides whether the answer is a correction — not the model: "ok" is returned only when
// the suggestion equals what the user typed (a missing article alone is not a correction: "Tisch"
// → ok + article der), so a changed word can never be saved silently.
func NormalizeWordCheck(raw WordCheck, input string) (WordCheck, error) {
	input = CollapseSpaces(input)
	w := WordCheck{
		Status:       strings.ToLower(strings.TrimSpace(raw.Status)),
		Input:        input,
		Lemma:        CollapseSpaces(raw.Lemma),
		Article:      normNullable(raw.Article),
		Plural:       normNullable(raw.Plural),
		PartOfSpeech: strings.ToLower(strings.TrimSpace(raw.PartOfSpeech)),
		Translation:  strings.TrimSpace(raw.Translation),
		Reason:       strings.TrimSpace(raw.Reason),
	}
	switch w.Status {
	case CheckOK, CheckCorrected:
	case CheckUnknown:
		return WordCheck{Status: CheckUnknown, Input: input, Reason: w.Reason}, nil
	default:
		return WordCheck{}, fmt.Errorf("%w: status %q", ErrInvalidWordCheck, raw.Status)
	}
	if w.Lemma == "" {
		return WordCheck{}, fmt.Errorf("%w: empty lemma", ErrInvalidWordCheck)
	}
	if len([]rune(w.Lemma)) > 100 {
		return WordCheck{}, fmt.Errorf("%w: lemma too long", ErrInvalidWordCheck)
	}
	if !IsPartOfSpeech(w.PartOfSpeech) {
		return WordCheck{}, fmt.Errorf("%w: part_of_speech %q", ErrInvalidWordCheck, raw.PartOfSpeech)
	}
	if w.Translation == "" {
		return WordCheck{}, fmt.Errorf("%w: empty translation", ErrInvalidWordCheck)
	}
	// The model sometimes repeats the article inside the lemma ("der Stift").
	if a, rest := SplitArticle(w.Lemma); a != "" && w.PartOfSpeech == PosNoun {
		w.Lemma = rest
		if w.Article == nil {
			w.Article = &a
		}
	}
	if w.PartOfSpeech == PosNoun {
		if w.Article == nil {
			return WordCheck{}, fmt.Errorf("%w: noun without article", ErrInvalidWordCheck)
		}
		a := strings.ToLower(*w.Article)
		if !IsGermanArticle(a) {
			return WordCheck{}, fmt.Errorf("%w: article %q", ErrInvalidWordCheck, *w.Article)
		}
		w.Article = &a
		w.Lemma = capitalize(w.Lemma) // German nouns are capitalized
		if w.Plural != nil {
			p := capitalize(*w.Plural)
			if pa, rest := SplitArticle(p); pa != "" {
				p = rest // "die Stifte" → "Stifte"
			}
			w.Plural = &p
		}
	} else {
		w.Article, w.Plural = nil, nil
	}

	if sameWord(w, input) {
		w.Status = CheckOK
		w.Reason = ""
	} else {
		w.Status = CheckCorrected
	}
	return w, nil
}

// sameWord: does the suggestion equal what the user typed? An article typed by the user must
// match; a missing one doesn't count as a difference. Phrases ignore final punctuation.
func sameWord(w WordCheck, input string) bool {
	inArticle, inRest := SplitArticle(input)
	if w.PartOfSpeech != PosNoun {
		inRest = input // "die" in "die ganze Zeit" is not an article to strip
	} else if inArticle != "" && (w.Article == nil || *w.Article != inArticle) {
		return false
	}
	a, b := inRest, w.Lemma
	if w.PartOfSpeech == PosPhrase {
		a, b = strings.TrimRight(a, ".!?…"), strings.TrimRight(b, ".!?…")
	}
	return a == b
}

func capitalize(s string) string {
	r := []rune(s)
	if len(r) == 0 {
		return s
	}
	r[0] = unicode.ToUpper(r[0])
	return string(r)
}

// CardToCheck is one saved word for the admin job "check existing words".
type CardToCheck struct {
	ID         uuid.UUID
	UserID     uuid.UUID
	Word       string
	NativeLang string // the owner's interface language (for translation/reason)
}

// WordFix is a suggested correction of a saved word. Nothing is applied until the user accepts it.
type WordFix struct {
	ID            uuid.UUID `json:"id"`
	UserID        uuid.UUID `json:"-"`
	WordID        uuid.UUID `json:"word_id"`
	OriginalWord  string    `json:"original_word"`
	SuggestedWord string    `json:"suggested_word"`
	Lemma         string    `json:"lemma"`
	Article       *string   `json:"article"`
	Plural        *string   `json:"plural"`
	PartOfSpeech  string    `json:"part_of_speech"`
	Reason        string    `json:"reason"`
	Status        string    `json:"status"`
	Translation   string    `json:"translation"` // the card's current translation, for context
	CreatedAt     time.Time `json:"created_at"`
}
