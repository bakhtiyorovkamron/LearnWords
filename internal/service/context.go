package service

import (
	"context"
	"fmt"
	"net/http"
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
	MaxImageSize   = 10 << 20
	maxWordsPerCtx = 50
)

var allowedImageTypes = map[string]string{"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp"}

type Providers struct {
	OCR         provider.OCR
	Translator  provider.Translator
	Transcriber provider.Transcriber
	TTS         provider.TTS
	Storage     provider.FileStorage
	Images      provider.ImageSearch // optional; nil disables photo search
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
	Text     string
	Image    []byte
	Language string
}

func (s *ContextService) Create(ctx context.Context, userID uuid.UUID, in CreateContextInput) (*domain.ContextWithCards, error) {
	ctx, span := tracer.Start(ctx, "ContextService.Create")
	defer span.End()

	if in.Language == "" {
		in.Language = "de"
	}
	c := domain.Context{ID: uuid.New(), UserID: userID, Language: in.Language, CreatedAt: time.Now().UTC()}
	text := strings.TrimSpace(in.Text)

	if len(in.Image) > 0 {
		if len(in.Image) > MaxImageSize {
			return nil, fmt.Errorf("%w: image too large", domain.ErrValidation)
		}
		ct := http.DetectContentType(in.Image)
		ext, ok := allowedImageTypes[ct]
		if !ok {
			return nil, fmt.Errorf("%w: unsupported image type %s", domain.ErrValidation, ct)
		}
		url, err := s.p.Storage.Upload(ctx, fmt.Sprintf("images/%s/%s.%s", userID, c.ID, ext), in.Image, ct)
		if err != nil {
			return nil, s.fail(span, "upload image", err)
		}
		c.ImageURL = &url
		if text == "" {
			ocrText, err := s.p.OCR.ExtractText(ctx, in.Image, in.Language)
			if err != nil {
				return nil, s.fail(span, "ocr", err)
			}
			text = strings.TrimSpace(ocrText)
		}
	}
	if text == "" {
		return nil, fmt.Errorf("%w: text or image with readable text is required", domain.ErrValidation)
	}
	c.SourceText = text

	words := Tokenize(text, in.Language)
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
		cards = append(cards, card)
	}

	// Best effort: a missing photo must never fail context creation.
	if c.ImageURL == nil && !hasClockTime(text) {
		if photos, err := s.findPhotos(ctx, text, 1); err == nil && len(photos) > 0 {
			c.ImageURL, c.PhotoCredit = &photos[0].URL, &photos[0].Credit
		} else if err != nil {
			span.RecordError(err)
		}
	}

	if err := s.contexts.CreateWithCards(ctx, &c, cards); err != nil {
		return nil, s.fail(span, "save context", err)
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
