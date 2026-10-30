package service

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"sync"

	"github.com/google/uuid"

	"learnwords/internal/domain"
)

// WordTranslator translates an already-identified word (and its example sentence) into a
// given native/interface language. nil → feature disabled (no AI key).
type WordTranslator interface {
	TranslateCard(ctx context.Context, req domain.TranslateRequest) (translation, exampleTranslation string, err error)
}

// WordTranslationCache stores a word's translation per interface language.
type WordTranslationCache interface {
	Get(ctx context.Context, wordID uuid.UUID, lang string) (translation, exampleTranslation string, ok bool, err error)
	Put(ctx context.Context, wordID uuid.UUID, lang, translation, exampleTranslation string) error
}

type TranslationService struct {
	cards WordCardRepository
	cache WordTranslationCache
	ai    WordTranslator
}

func NewTranslationService(cards WordCardRepository, cache WordTranslationCache, ai WordTranslator) *TranslationService {
	return &TranslationService{cards: cards, cache: cache, ai: ai}
}

// CardTranslation is one word's translation in the requested language.
type CardTranslation struct {
	Translation        string `json:"translation"`
	ExampleTranslation string `json:"example_translation"`
}

const maxTranslationBatch = 10

// Translate returns wordID's translation in nativeLang. The word and its example are decided
// separately, because they can be written in different languages (examples made before the prompt
// fix are Russian; imported cards keep theirs):
//
//	word:    the card's own translation when it is written in nativeLang (what the user saw and typed —
//	         training must agree with the card), else the cache, else AI.
//	example: the card's own example translation only when ITS language is nativeLang (or the card has
//	         no example), else the cache, else AI.
//
// One AI call at most, told the card's known meaning so it translates exactly that sense; the result
// is cached. A Cyrillic example is never returned for "uz" or "en", whatever the stored language says.
// Never falls back to a different language silently.
func (s *TranslationService) Translate(ctx context.Context, userID, wordID uuid.UUID, nativeLang string) (CardTranslation, error) {
	card, err := s.cards.GetByID(ctx, userID, wordID)
	if err != nil {
		return CardTranslation{}, err
	}
	native := domain.NormTranslationLang(nativeLang)

	word := ""
	if card.TranslationLanguage != nil && *card.TranslationLanguage == native {
		word = strings.TrimSpace(card.Translation)
	}
	hasExample := strings.TrimSpace(card.ExampleSentence) != "" || strings.TrimSpace(card.ExampleTranslation) != ""
	example, exampleOK := "", !hasExample // nothing to translate when there is no example
	if hasExample && card.ExampleTranslationLanguage != nil && *card.ExampleTranslationLanguage == native {
		example = rightLanguageExample(native, card.ExampleTranslation)
		exampleOK = example != ""
	}
	if word != "" && exampleOK {
		return CardTranslation{Translation: card.Translation, ExampleTranslation: example}, nil
	}

	if tr, ex, ok, err := s.cache.Get(ctx, wordID, native); err == nil && ok {
		if word == "" && strings.TrimSpace(tr) != "" {
			word = tr
		}
		if !exampleOK {
			if cached := rightLanguageExample(native, ex); cached != "" {
				example, exampleOK = cached, true
			}
		}
	}
	if word != "" && exampleOK {
		return CardTranslation{Translation: word, ExampleTranslation: example}, nil
	}

	// Something is missing. With the word in hand a missing example is not worth failing for: the
	// word is returned alone (never an example in the wrong language) and the next try asks again.
	if s.ai == nil {
		if word != "" {
			return CardTranslation{Translation: word, ExampleTranslation: example}, nil
		}
		return CardTranslation{}, domain.ErrUnavailable
	}
	req := domain.TranslateRequest{
		LearningLang: card.Language, NativeLang: native,
		Word:            firstCardWord(card.Word),
		ExampleSentence: fillGap(card),
		KnownMeaning:    strings.TrimSpace(card.Translation),
	}
	if card.TranslationLanguage != nil {
		req.KnownMeaningLang = *card.TranslationLanguage
	}
	tr, ex, err := s.ai.TranslateCard(ctx, req)
	if err != nil {
		if word != "" {
			slog.WarnContext(ctx, "example translation failed; returning the word alone", "word", wordID, "err", err)
			return CardTranslation{Translation: word, ExampleTranslation: example}, nil
		}
		return CardTranslation{}, fmt.Errorf("%w: %v", domain.ErrUpstream, err)
	}
	if word == "" {
		word = tr
	}
	if !exampleOK {
		example = rightLanguageExample(native, ex)
	}
	if err := s.cache.Put(ctx, wordID, native, word, example); err != nil {
		return CardTranslation{}, err // cache write is the only persistence here — a failure must surface
	}
	return CardTranslation{Translation: word, ExampleTranslation: example}, nil
}

// rightLanguageExample trims an example translation and drops it when it cannot be in lang:
// Cyrillic text is never a Uzbek (Latin) or English translation.
func rightLanguageExample(lang, example string) string {
	example = strings.TrimSpace(example)
	if (lang == "uz" || lang == "en") && hasCyrillic(example) {
		return ""
	}
	return example
}

// TranslateBatch resolves several words at once (e.g. a quiz question's right answer + its
// multiple-choice distractors), one AI call per cache miss, run concurrently. A single word's
// failure (not found, AI error) is skipped rather than failing the whole batch — the caller
// shows nothing for that word rather than a stale or wrong-language guess.
func (s *TranslationService) TranslateBatch(ctx context.Context, userID uuid.UUID, wordIDs []uuid.UUID, nativeLang string) map[uuid.UUID]CardTranslation {
	if len(wordIDs) > maxTranslationBatch {
		wordIDs = wordIDs[:maxTranslationBatch]
	}
	var mu sync.Mutex
	out := make(map[uuid.UUID]CardTranslation, len(wordIDs))
	var wg sync.WaitGroup
	for _, id := range wordIDs {
		wg.Add(1)
		go func(id uuid.UUID) {
			defer wg.Done()
			tr, err := s.Translate(ctx, userID, id, nativeLang)
			if err != nil {
				return
			}
			mu.Lock()
			out[id] = tr
			mu.Unlock()
		}(id)
	}
	wg.Wait()
	return out
}

// fillGap turns the stored gap sentence ("Ich bin ___.") into the full one by putting the word
// back: the lemma when the word check found one, else the word without its article.
func fillGap(card *domain.WordCard) string {
	sentence := strings.TrimSpace(card.ExampleSentence)
	if !strings.Contains(sentence, "___") {
		return sentence
	}
	fill := ""
	if card.Lemma != nil {
		fill = strings.TrimSpace(*card.Lemma)
	}
	if fill == "" {
		_, fill = domain.SplitArticle(firstCardWord(card.Word))
	}
	return strings.ReplaceAll(sentence, "___", fill)
}

// firstCardWord: "der Samstag / der Sonnabend" → "der Samstag" (translate one spelling, not the slash-joined pair).
func firstCardWord(word string) string {
	if v := SplitVariants(word); v != nil {
		return v[0]
	}
	return word
}
