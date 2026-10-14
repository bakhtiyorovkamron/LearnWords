package domain

import (
	"time"

	"github.com/google/uuid"
)

// StoryWord is a word used in a daily story. Translation is its gloss in whichever native
// language the story is currently being viewed in (resolved from the story's translations —
// see DailyStory.Language), not necessarily the language it was stored with originally.
type StoryWord struct {
	Word        string `json:"word"`
	Translation string `json:"translation"`
	// Grammar from the word check (empty for unchecked words): the story prompt gets
	// "der Stift" / "kommen" instead of whatever was typed ("Sfit", "komme").
	Lemma        string `json:"lemma,omitempty"`
	Article      string `json:"article,omitempty"`
	PartOfSpeech string `json:"part_of_speech,omitempty"`
	// Forms are the exact spellings this word has in the story text ("kommt" for "kommen"),
	// reported by the proofreading step — used to highlight the word wherever it appears.
	Forms []string `json:"forms,omitempty"`
}

// PromptForm is how the word is given to the story generator: article + lemma when known,
// otherwise the saved text.
func (w StoryWord) PromptForm() string {
	switch {
	case w.Lemma == "":
		return w.Word
	case w.Article != "":
		return w.Article + " " + w.Lemma
	default:
		return w.Lemma
	}
}

// DailyStory is an AI-generated story in the user's learning language, built from the words
// added that day. StoryDE (and the title) are in the learning language and shared by every
// viewer regardless of interface language. StoryTranslation and each WordsUsed[].Translation
// are resolved for whichever native language was requested — see Language — generated via AI
// and cached on first view (StoryTranslator / StoryService), never silently left in some other
// language.
type DailyStory struct {
	ID     uuid.UUID `json:"id"`
	UserID uuid.UUID `json:"-"`
	Date   string    `json:"date"` // YYYY-MM-DD
	Genre  string    `json:"genre"`
	Title  string    `json:"title"`
	// StoryDE is the story text in the learning language (field name kept for compatibility —
	// it is not always literally German, it's whatever domain.LangFrom(ctx) was at generation).
	StoryDE string `json:"story_de"`
	// StoryTranslation is the story's translation into Language. Empty if not yet resolved
	// (translation generation is unavailable or failed) — never a guess in the wrong language.
	StoryTranslation string      `json:"story_translation"`
	Language         string      `json:"language"` // native language StoryTranslation/word glosses are in
	WordsUsed        []StoryWord `json:"words_used"`
	ProofreadStatus  string      `json:"proofread_status"`
	CreatedAt        time.Time   `json:"created_at"`
}

// Proofread outcome stored in daily_stories.proofread_status.
const (
	ProofreadNone    = "none"    // no proofreader configured
	ProofreadChecked = "checked" // the text shown is the proofread one
	ProofreadFailed  = "failed"  // both attempts failed — the original text is shown
)

// StoryCorrection is one fix made by the proofreading step (stored for statistics).
type StoryCorrection struct {
	From string `json:"from"`
	To   string `json:"to"`
	Why  string `json:"why"`
}

// ProofreadStory is the output of the second AI pass over a generated story.
type ProofreadStory struct {
	Title       string              `json:"title"`
	Text        string              `json:"text"`
	Corrections []StoryCorrection   `json:"corrections"`
	WordForms   map[string][]string `json:"word_forms"` // list word (as given) → spellings used in the text
}

// GeneratedStory is the raw LLM output for the learning-language generation step.
type GeneratedStory struct {
	Title   string `json:"title"`
	StoryDE string `json:"story_de"`
}

// StoryTranslation is one story's translation into one native language, with a short gloss
// per learning-language word used in it.
type StoryTranslation struct {
	Translation string            `json:"translation"`
	WordGlosses map[string]string `json:"word_glosses"`
}
