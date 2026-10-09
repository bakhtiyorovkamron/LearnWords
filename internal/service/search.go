package service

import (
	"context"
	"fmt"
	"log/slog"
	"strings"

	"github.com/google/uuid"

	"learnwords/internal/domain"
)

// WordLookup finds a German word (by German spelling or Russian translation) via AI.
type WordLookup interface {
	LookupWord(ctx context.Context, query string) (domain.WordInfo, error)
}

// WordExistence checks the user's collection for a spelling.
type WordExistence interface {
	HasWord(ctx context.Context, userID uuid.UUID, forms ...string) (bool, error)
}

// SearchCache stores AI results by normalized query (nil → no caching).
type SearchCache interface {
	Get(ctx context.Context, query string) (domain.WordInfo, bool, error)
	Put(ctx context.Context, query string, w domain.WordInfo) error
}

const maxSearchQueryLen = 100

type SearchService struct {
	ai       WordLookup // nil → feature disabled (no API key)
	words    WordExistence
	contexts *ContextService
	cache    SearchCache
}

func NewSearchService(ai WordLookup, words WordExistence, contexts *ContextService, cache SearchCache) *SearchService {
	return &SearchService{ai: ai, words: words, contexts: contexts, cache: cache}
}

// NormalizeQuery is the cache key: case-insensitive, outer spaces ignored.
func NormalizeQuery(q string) string { return strings.ToLower(strings.TrimSpace(q)) }

// searchCacheVersion is bumped whenever the prompt logic changes; migrations delete older keys.
// v4: two-step lookup (Sonnet resolves the word, Haiku assembles the card) + server-side
// validation, fixing native-language words (e.g. Uzbek "sen") leaking into "word" unresolved.
const searchCacheVersion = "v4"

// SearchCacheKey: "v4:<learning>:<native>:<normalized query>", e.g. "v4:de:uz:men".
func SearchCacheKey(learningLang, nativeLang, query string) string {
	return searchCacheVersion + ":" + domain.Lang(learningLang).Code + ":" +
		domain.NormTranslationLang(nativeLang) + ":" + NormalizeQuery(query)
}

// Search returns the dictionary entry (from cache, else from AI) plus whether the word
// is already in the user's collection.
func (s *SearchService) Search(ctx context.Context, userID uuid.UUID, query string) (*domain.WordInfo, error) {
	query = strings.TrimSpace(query)
	if query == "" || len([]rune(query)) > maxSearchQueryLen {
		return nil, fmt.Errorf("%w: query must be 1-%d characters", domain.ErrValidation, maxSearchQueryLen)
	}
	// The same spelling means different words in different languages ("men" is Uzbek "I"),
	// and the translation is written in the native language → both languages are part of the key.
	key := SearchCacheKey(domain.LangFrom(ctx), domain.TranslationLangFrom(ctx), query)

	info, hit := domain.WordInfo{}, false
	if s.cache != nil {
		var err error
		if info, hit, err = s.cache.Get(ctx, key); err != nil {
			slog.WarnContext(ctx, "search cache get failed", "query", key, "err", err) // cache must not break search
		}
	}
	if !hit {
		if s.ai == nil {
			return nil, domain.ErrUnavailable
		}
		var err error
		if info, err = s.ai.LookupWord(ctx, query); err != nil {
			return nil, fmt.Errorf("%w: %v", domain.ErrUpstream, err)
		}
		if s.cache != nil {
			if err := s.cache.Put(context.WithoutCancel(ctx), key, info); err != nil {
				slog.WarnContext(ctx, "search cache put failed", "query", key, "err", err)
			}
		}
	}
	slog.InfoContext(ctx, "search-word", "query", key, "cache_hit", hit, "query_language", info.QueryLanguage)
	info.TranslationLanguage = domain.TranslationLangFrom(ctx)
	if info.Alternatives == nil {
		info.Alternatives = []string{}
	}

	var err error
	if info.AlreadyAdded, err = s.words.HasWord(ctx, userID, info.FullWord(), info.Word); err != nil {
		return nil, err
	}
	return &info, nil
}

// AddInput is what the search page sends back to save a found word (no second AI call).
type AddInput struct {
	Word               string
	Translation        string
	Pronunciation      string
	ExampleSentence    string
	ExampleTranslation string
	FolderID           *uuid.UUID
}

// Add saves the word through the normal creation flow (same as the "Add" page: context + card +
// Leitner progress on first review). Rejects duplicates with ErrAlreadyExists (checked before insert).
func (s *SearchService) Add(ctx context.Context, userID uuid.UUID, in AddInput) (*domain.ContextWithCards, error) {
	word := strings.Join(strings.Fields(in.Word), " ")
	if word == "" || len([]rune(word)) > 100 {
		return nil, fmt.Errorf("%w: word must be 1-100 characters", domain.ErrValidation)
	}
	if strings.TrimSpace(in.Translation) == "" {
		return nil, fmt.Errorf("%w: translation is required", domain.ErrValidation)
	}
	forms := []string{word}
	if f := strings.Fields(word); len(f) == 2 && isArticle(f[0]) {
		forms = append(forms, f[1]) // "der Hund" also matches an existing "Hund"
	}
	exists, err := s.words.HasWord(ctx, userID, forms...)
	if err != nil {
		return nil, err
	}
	if exists {
		return nil, fmt.Errorf("%w: word is already in the collection", domain.ErrAlreadyExists)
	}
	// Example from the search result: the gap-fill format needs "___" instead of the word.
	example := gapExample(in.ExampleSentence, word)
	return s.contexts.Create(ctx, userID, CreateContextInput{
		Text:               word,
		Meaning:            in.Translation,
		Pronunciation:      in.Pronunciation,
		ExampleSentence:    example,
		ExampleTranslation: in.ExampleTranslation,
		Language:           domain.LangFrom(ctx),
		FolderID:           in.FolderID,
		SingleWord:         true,
	})
}

func isArticle(s string) bool {
	switch strings.ToLower(s) {
	case "der", "die", "das", // de
		"le", "la", "les", // fr
		"a", "an", "the", "to": // en ("to go")
		return true
	}
	return false
}

// gapExample replaces the word (without article, case-insensitive) in the sentence with "___".
// If the word isn't found literally (e.g. a conjugated verb form), the sentence is kept as is.
func gapExample(sentence, word string) string {
	sentence = strings.TrimSpace(sentence)
	if sentence == "" || strings.Contains(sentence, "___") {
		return sentence
	}
	core := word
	if f := strings.Fields(word); len(f) == 2 && isArticle(f[0]) {
		core = f[1]
	}
	idx := strings.Index(strings.ToLower(sentence), strings.ToLower(core))
	if idx < 0 || core == "" {
		return sentence
	}
	return sentence[:idx] + "___" + sentence[idx+len(core):]
}
