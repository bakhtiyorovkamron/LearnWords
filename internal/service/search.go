package service

import (
	"context"
	"fmt"
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

const maxSearchQueryLen = 100

type SearchService struct {
	ai       WordLookup // nil → feature disabled (no API key)
	words    WordExistence
	contexts *ContextService
}

func NewSearchService(ai WordLookup, words WordExistence, contexts *ContextService) *SearchService {
	return &SearchService{ai: ai, words: words, contexts: contexts}
}

// Search returns the AI dictionary entry plus whether the word is already in the user's collection.
func (s *SearchService) Search(ctx context.Context, userID uuid.UUID, query string) (*domain.WordInfo, error) {
	query = strings.TrimSpace(query)
	if query == "" || len([]rune(query)) > maxSearchQueryLen {
		return nil, fmt.Errorf("%w: query must be 1-%d characters", domain.ErrValidation, maxSearchQueryLen)
	}
	if s.ai == nil {
		return nil, domain.ErrUnavailable
	}
	info, err := s.ai.LookupWord(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", domain.ErrUpstream, err)
	}
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
		Language:           "de",
		FolderID:           in.FolderID,
		SingleWord:         true,
	})
}

func isArticle(s string) bool {
	switch strings.ToLower(s) {
	case "der", "die", "das":
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
