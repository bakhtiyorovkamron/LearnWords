// story_proofread.go: the second pass over a generated story — fixes grammar (articles, cases,
// agreement) without changing the plot or dropping the listed words, and reports which spelling
// each listed word has in the text (for highlighting by lemma).
package anthropic

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"learnwords/internal/domain"
)

const storyProofreadPrompt = `You are a careful {{target}} editor. Proofread this short story for {{target}} learners.

Title: {{title}}
Story:
"""
{{story}}
"""

Check grammar, articles, cases, adjective endings and subject-verb agreement, and fix every mistake
(e.g. "Die magische Stift" → "Der magische Stift", "Sie komme" → "Sie kommt").
Do NOT change the plot, do NOT rewrite correct sentences, do NOT remove any of these words (they may stay in any grammatical form):
{{words}}
Keep the **bold** markers around the same words (move them along if a word's form changes), keep paragraph breaks as \n (escaped).

Also report, for each listed word (use exactly the spelling from the list as the key), the spellings it has in the final text.

Return ONLY this JSON:
{"title":"...","text":"...","corrections":[{"from":"...","to":"...","why":"..."}],"word_forms":{"<word>":["..."]}}
"corrections" lists every change you made (empty array if the story was already correct); "why" is a short English explanation.`

func buildStoryProofreadPrompt(learningLang, title, story string, words []domain.StoryWord) string {
	var b strings.Builder
	for _, w := range words {
		fmt.Fprintf(&b, "- %s\n", clean(w.PromptForm()))
	}
	return strings.NewReplacer(
		"{{target}}", domain.Lang(learningLang).NameEN,
		"{{title}}", clean(title),
		"{{story}}", story,
		"{{words}}", strings.TrimRight(b.String(), "\n"),
	).Replace(storyProofreadPrompt)
}

const storyProofreadTimeout = 60 * time.Second

// ProofreadStory makes ONE model call and parses the answer; validation and the single retry
// are done by the story service, which falls back to the original text.
func (c *Client) ProofreadStory(ctx context.Context, title, story string, words []domain.StoryWord) (domain.ProofreadStory, error) {
	prompt := buildStoryProofreadPrompt(domain.LangFrom(ctx), title, story, words)
	// The whole text comes back, plus the corrections list and word forms.
	maxTokens := min(len(story)/2+80*len(words)+1000, 4000)
	text, err := c.completeWith(ctx, c.model, prompt, searchPrefill, maxTokens, storyProofreadTimeout)
	if err != nil {
		return domain.ProofreadStory{}, err
	}
	return parseProofread(text)
}

func parseProofread(s string) (domain.ProofreadStory, error) {
	s = extractJSONObject(s)
	var out domain.ProofreadStory
	if err := json.Unmarshal([]byte(s), &out); err != nil {
		if err2 := json.Unmarshal([]byte(repairJSONStrings(s)), &out); err2 != nil {
			return domain.ProofreadStory{}, fmt.Errorf("parse proofread json: %w", err)
		}
	}
	out.Title = strings.TrimSpace(out.Title)
	out.Text = strings.TrimSpace(out.Text)
	return out, nil
}
