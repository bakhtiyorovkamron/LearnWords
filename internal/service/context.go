package service

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/trace"

	"learnwords/internal/domain"
)

var tracer = otel.Tracer("learnwords/service")

// Providers holds the optional external integrations.
type Providers struct {
	Examples ExampleGenerator // optional; nil disables AI example generation
}

type ContextService struct {
	contexts ContextRepository
	cards    WordCardRepository
	p        Providers
}

func NewContextService(contexts ContextRepository, cards WordCardRepository, p Providers) *ContextService {
	return &ContextService{contexts: contexts, cards: cards, p: p}
}

// Limits of a saved word or phrase (in runes). Longer text goes through the photo import.
const maxWordLen = 100

type CreateContextInput struct {
	// Text is the word or phrase; Meaning its translation (required). They become exactly ONE card.
	Text          string
	Meaning       string
	Pronunciation string
	// Optional example sentence entered (or already generated) by the user.
	ExampleSentence    string
	ExampleTranslation string
	Language           string
	// Optional folder for the card (ignored if it isn't the user's folder).
	FolderID *uuid.UUID
	// Grammar from the word check (lemma, article, plural, part of speech) the user agreed to.
	Grammar *domain.WordGrammar
}

// Create saves one word or phrase as one card with the user's translation. Nothing is
// translated, transcribed or synthesized here: what the card says comes from the user (or from the
// search result they confirmed), and an example sentence is generated in the background if none was given.
func (s *ContextService) Create(ctx context.Context, userID uuid.UUID, in CreateContextInput) (*domain.ContextWithCards, error) {
	ctx, span := tracer.Start(ctx, "ContextService.Create")
	defer span.End()

	// The learning language belongs to the account (chosen at registration), not to the request.
	in.Language = domain.LangFrom(ctx)
	c := domain.Context{ID: uuid.New(), UserID: userID, Language: in.Language, CreatedAt: time.Now().UTC()}

	text := strings.Join(strings.Fields(in.Text), " ")
	if n := len([]rune(text)); n < 1 || n > maxWordLen {
		return nil, fmt.Errorf("%w: text must be 1-%d characters", domain.ErrValidation, maxWordLen)
	}
	meaning := strings.TrimSpace(in.Meaning)
	if meaning == "" {
		return nil, fmt.Errorf("%w: translation is required", domain.ErrValidation)
	}
	if len([]rune(meaning)) > 500 {
		return nil, fmt.Errorf("%w: meaning too long", domain.ErrValidation)
	}
	if err := in.Grammar.Validate(); err != nil {
		return nil, err
	}
	c.SourceText = text
	c.Meaning = meaning

	// "der Samstag / der Sonnabend": one word with equivalent spellings → one card that keeps both.
	word := text
	variants := SplitVariants(text)
	if variants != nil {
		word = strings.Join(variants, " / ")
	}

	card := domain.WordCard{
		ID: uuid.New(), ContextID: c.ID, UserID: userID,
		Word: word, Language: c.Language, CreatedAt: c.CreatedAt,
		FolderID:    in.FolderID,
		Translation: meaning,
		// What the user typed is in the language they use the app in right now.
		TranslationLanguage: ptrString(domain.TranslationLangFrom(ctx)),
		Transcription:       strings.TrimSpace(in.Pronunciation),
		ExampleSentence:     strings.TrimSpace(in.ExampleSentence),
		ExampleTranslation:  strings.TrimSpace(in.ExampleTranslation),
	}
	card.SetGrammar(in.Grammar)
	if len([]rune(card.ExampleSentence)) > 500 || len([]rune(card.ExampleTranslation)) > 500 {
		return nil, fmt.Errorf("%w: example too long", domain.ErrValidation)
	}

	if err := s.contexts.CreateWithCards(ctx, &c, []domain.WordCard{card}); err != nil {
		return nil, s.fail(span, "save context", err)
	}
	// No example entered manually: generate one in the background after saving.
	if card.ExampleSentence == "" {
		forExample := card
		if variants != nil {
			forExample.Word = variants[0] // generate only for the first variant
		}
		s.generateExampleAsync(userID, forExample)
	}
	return &domain.ContextWithCards{Context: c, Cards: []domain.WordCard{card}}, nil
}

func ptrString(s string) *string { return &s }

func (s *ContextService) Cards(ctx context.Context, userID uuid.UUID, limit, offset int) ([]domain.WordCard, error) {
	return s.cards.ListByUser(ctx, userID, limit, offset)
}

func (s *ContextService) fail(span trace.Span, op string, err error) error {
	span.RecordError(err)
	span.SetStatus(codes.Error, op)
	return fmt.Errorf("%s: %w", op, err)
}
