package service

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/google/uuid"

	"learnwords/internal/domain"
)

// ExampleGenerator produces an example sentence for a word (implemented by the Anthropic client).
type ExampleGenerator interface {
	Generate(ctx context.Context, word, translation string) (domain.Example, error)
}

const (
	maxExampleWordLen = 100
	maxExampleTransLn = 500
	bgExampleTimeout  = 45 * time.Second
)

// GenerateExample returns an AI-generated example sentence (not saved).
func (s *ContextService) GenerateExample(ctx context.Context, word, translation string) (*domain.Example, error) {
	ctx, span := tracer.Start(ctx, "ContextService.GenerateExample")
	defer span.End()

	word, translation = strings.TrimSpace(word), strings.TrimSpace(translation)
	if word == "" || translation == "" {
		return nil, fmt.Errorf("%w: word and translation are required", domain.ErrValidation)
	}
	if len([]rune(word)) > maxExampleWordLen || len([]rune(translation)) > maxExampleTransLn {
		return nil, fmt.Errorf("%w: word or translation too long", domain.ErrValidation)
	}
	if s.p.Examples == nil {
		return nil, domain.ErrUnavailable
	}
	ex, err := s.p.Examples.Generate(ctx, word, translation)
	if err != nil {
		span.RecordError(err)
		return nil, fmt.Errorf("%w: %v", domain.ErrUpstream, err)
	}
	return &ex, nil
}

// generateExampleAsync fills the example for a freshly saved card in the background,
// so the user's request is not blocked by the LLM call.
func (s *ContextService) generateExampleAsync(userID uuid.UUID, card domain.WordCard) {
	if s.p.Examples == nil {
		return
	}
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), bgExampleTimeout)
		defer cancel()
		time.Sleep(time.Second) // let the create request finish first
		ex, err := s.p.Examples.Generate(ctx, card.Word, card.Translation)
		if err != nil {
			slog.Warn("background example generation failed", "card", card.ID, "err", err)
			return
		}
		if err := s.cards.UpdateExample(ctx, userID, card.ID, ex.SentenceWithGap, ex.Translation); err != nil {
			slog.Warn("saving generated example failed", "card", card.ID, "err", err)
		}
	}()
}
