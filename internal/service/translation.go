package service

import (
	"context"
	"fmt"
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

// Translate returns wordID's translation in nativeLang. In order:
//  1. the card's own translation, when it is written in nativeLang (what the user saw and typed —
//     training must agree with the card; no cache lookup, no AI);
//  2. the cache;
//  3. AI, told the card's known meaning so it translates exactly that sense, then cached.
//
// Never falls back to a different language silently.
func (s *TranslationService) Translate(ctx context.Context, userID, wordID uuid.UUID, nativeLang string) (CardTranslation, error) {
	card, err := s.cards.GetByID(ctx, userID, wordID)
	if err != nil {
		return CardTranslation{}, err
	}
	nativeLang = domain.NormTranslationLang(nativeLang)
	if card.TranslationLanguage != nil && *card.TranslationLanguage == nativeLang && strings.TrimSpace(card.Translation) != "" {
		return CardTranslation{Translation: card.Translation, ExampleTranslation: card.ExampleTranslation}, nil
	}
	if tr, ex, ok, err := s.cache.Get(ctx, wordID, nativeLang); err == nil && ok {
		return CardTranslation{Translation: tr, ExampleTranslation: ex}, nil
	}
	if s.ai == nil {
		return CardTranslation{}, domain.ErrUnavailable
	}
	req := domain.TranslateRequest{
		LearningLang: card.Language, NativeLang: nativeLang,
		Word:            firstCardWord(card.Word),
		ExampleSentence: fillGap(card),
		KnownMeaning:    strings.TrimSpace(card.Translation),
	}
	if card.TranslationLanguage != nil {
		req.KnownMeaningLang = *card.TranslationLanguage
	}
	tr, ex, err := s.ai.TranslateCard(ctx, req)
	if err != nil {
		return CardTranslation{}, fmt.Errorf("%w: %v", domain.ErrUpstream, err)
	}
	if err := s.cache.Put(ctx, wordID, nativeLang, tr, ex); err != nil {
		return CardTranslation{}, err // cache write is the only persistence here — a failure must surface
	}
	return CardTranslation{Translation: tr, ExampleTranslation: ex}, nil
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
