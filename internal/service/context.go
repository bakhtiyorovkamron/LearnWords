package service

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/trace"

	"learnwords/internal/domain"
	"learnwords/internal/provider"
)

var tracer = otel.Tracer("learnwords/service")

const (
	MaxImageSize   = 5 << 20
	maxWordsPerCtx = 50
)

var allowedImageTypes = map[string]string{"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp"}

type Providers struct {
	OCR         provider.OCR
	Translator  provider.Translator
	Transcriber provider.Transcriber
	TTS         provider.TTS
	Storage     provider.FileStorage
	Examples    ExampleGenerator // optional; nil disables AI example generation
}

type ContextService struct {
	contexts   ContextRepository
	cards      WordCardRepository
	p          Providers
	targetLang string
}

func NewContextService(contexts ContextRepository, cards WordCardRepository, p Providers, targetLang string) *ContextService {
	return &ContextService{contexts: contexts, cards: cards, p: p, targetLang: targetLang}
}

type CreateContextInput struct {
	Text          string
	Meaning       string
	Pronunciation string
	// Optional example sentence entered (or already generated) by the user.
	ExampleSentence    string
	ExampleTranslation string
	Image              []byte
	Language           string
}

func (s *ContextService) Create(ctx context.Context, userID uuid.UUID, in CreateContextInput) (*domain.ContextWithCards, error) {
	ctx, span := tracer.Start(ctx, "ContextService.Create")
	defer span.End()

	if in.Language == "" {
		in.Language = "de"
	}
	c := domain.Context{ID: uuid.New(), UserID: userID, Language: in.Language, CreatedAt: time.Now().UTC()}
	text := strings.TrimSpace(in.Text)
	meaning := strings.TrimSpace(in.Meaning)
	if len([]rune(meaning)) > 500 {
		return nil, fmt.Errorf("%w: meaning too long", domain.ErrValidation)
	}
	c.Meaning = meaning

	if len(in.Image) > 0 {
		url, err := imageDataURL(in.Image)
		if err != nil {
			return nil, err
		}
		c.ImageURL = &url
	}
	if text == "" {
		return nil, fmt.Errorf("%w: text is required", domain.ErrValidation)
	}
	c.SourceText = text

	words := Tokenize(text, in.Language)
	// A single typed word (e.g. "ich") must become a card even if it is a stopword.
	if len(words) == 0 {
		if fields := strings.Fields(text); len(fields) == 1 {
			if w := strings.Trim(fields[0], ".,;:!?\"“„'()-"); w != "" {
				words = []string{w}
			}
		}
	}
	if len(words) > maxWordsPerCtx {
		words = words[:maxWordsPerCtx]
	}
	span.SetAttributes(attribute.Int("words.count", len(words)))

	// Sequential for now; can be parallelized (errgroup) or moved to an async worker queue.
	cards := make([]domain.WordCard, 0, len(words))
	for _, w := range words {
		card, err := s.buildCard(ctx, c, w)
		if err != nil {
			return nil, s.fail(span, "build card", err)
		}
		// A single-word phrase: the user's meaning is the word's translation.
		if len(words) == 1 {
			if meaning != "" {
				card.Translation = meaning
			}
			if p := strings.TrimSpace(in.Pronunciation); p != "" {
				card.Transcription = p
			}
			card.ExampleSentence = strings.TrimSpace(in.ExampleSentence)
			card.ExampleTranslation = strings.TrimSpace(in.ExampleTranslation)
			if len([]rune(card.ExampleSentence)) > 500 || len([]rune(card.ExampleTranslation)) > 500 {
				return nil, fmt.Errorf("%w: example too long", domain.ErrValidation)
			}
		}
		cards = append(cards, card)
	}

	if err := s.contexts.CreateWithCards(ctx, &c, cards); err != nil {
		return nil, s.fail(span, "save context", err)
	}
	// No example entered manually: generate one in the background after saving.
	if len(cards) == 1 && cards[0].ExampleSentence == "" {
		s.generateExampleAsync(userID, cards[0])
	}
	return &domain.ContextWithCards{Context: c, Cards: cards}, nil
}

func (s *ContextService) buildCard(ctx context.Context, c domain.Context, word string) (domain.WordCard, error) {
	card := domain.WordCard{
		ID: uuid.New(), ContextID: c.ID, UserID: c.UserID,
		Word: word, Language: c.Language, CreatedAt: c.CreatedAt,
	}
	var err error
	if card.Translation, err = s.p.Translator.Translate(ctx, word, c.Language, s.targetLang); err != nil {
		return card, fmt.Errorf("translate %q: %w", word, err)
	}
	if card.Transcription, err = s.p.Transcriber.Transcribe(ctx, word, c.Language); err != nil {
		return card, fmt.Errorf("transcribe %q: %w", word, err)
	}
	url, err := s.synthesize(ctx, c.UserID, card.ID, word, c.Language)
	if err != nil {
		return card, err
	}
	card.AudioURL = &url
	return card, nil
}

func (s *ContextService) synthesize(ctx context.Context, userID, cardID uuid.UUID, word, lang string) (string, error) {
	audio, mime, err := s.p.TTS.Synthesize(ctx, word, lang)
	if err != nil {
		return "", fmt.Errorf("tts %q: %w", word, err)
	}
	return s.p.Storage.Upload(ctx, fmt.Sprintf("audio/%s/%s.mp3", userID, cardID), audio, mime)
}

func (s *ContextService) List(ctx context.Context, userID uuid.UUID, limit, offset int) ([]domain.Context, error) {
	return s.contexts.ListByUser(ctx, userID, limit, offset)
}

func (s *ContextService) Words(ctx context.Context, userID, contextID uuid.UUID) ([]domain.WordCard, error) {
	if _, err := s.contexts.GetByID(ctx, userID, contextID); err != nil {
		return nil, err
	}
	return s.cards.ListByContext(ctx, userID, contextID)
}

func (s *ContextService) Cards(ctx context.Context, userID uuid.UUID, limit, offset int) ([]domain.WordCard, error) {
	return s.cards.ListByUser(ctx, userID, limit, offset)
}

// RegenerateAudio re-synthesizes pronunciation for a card.
func (s *ContextService) RegenerateAudio(ctx context.Context, userID, cardID uuid.UUID) (*domain.WordCard, error) {
	ctx, span := tracer.Start(ctx, "ContextService.RegenerateAudio")
	defer span.End()

	card, err := s.cards.GetByID(ctx, userID, cardID)
	if err != nil {
		return nil, err
	}
	url, err := s.synthesize(ctx, userID, card.ID, card.Word, card.Language)
	if err != nil {
		return nil, s.fail(span, "synthesize", err)
	}
	if err := s.cards.UpdateAudioURL(ctx, userID, card.ID, url); err != nil {
		return nil, err
	}
	card.AudioURL = &url
	return card, nil
}

func (s *ContextService) fail(span trace.Span, op string, err error) error {
	span.RecordError(err)
	span.SetStatus(codes.Error, op)
	return fmt.Errorf("%s: %w", op, err)
}
