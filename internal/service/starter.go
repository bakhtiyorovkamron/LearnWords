package service

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"

	"learnwords/internal/domain"
	"learnwords/internal/starter"
)

// StarterStore saves the starter folder with all its words in one transaction.
type StarterStore interface {
	CreateFolderWithContexts(ctx context.Context, f *domain.Folder, items []domain.ContextWithCards) error
}

// StarterService gives a new user the "Introductions" folder: everyday phrases in the language they
// learn, with the translations in the interface language of the request.
type StarterService struct {
	store   StarterStore
	content *starter.Content
	now     func() time.Time
}

func NewStarterService(store StarterStore) (*StarterService, error) {
	c, err := starter.Load()
	if err != nil {
		return nil, err
	}
	return &StarterService{store: store, content: c, now: time.Now}, nil
}

// StarterPartOfSpeech marks the starter cards as phrases (no lemma, no article).
const StarterPartOfSpeech = "phrase"

// Create makes the folder and its words for userID. The interface language is
// domain.TranslationLangFrom(ctx) (Russian by default). The cards are paused: they stay out of the
// general training queue until the user trains them (see word_cards.paused).
func (s *StarterService) Create(ctx context.Context, userID uuid.UUID, learningLang string) error {
	phrases := s.content.Phrases(learningLang)
	if len(phrases) == 0 {
		return nil // a language without a starter set gets no folder
	}
	native := domain.NormTranslationLang(domain.TranslationLangFrom(ctx))
	base := s.now().UTC()
	folder := &domain.Folder{ID: uuid.New(), UserID: userID, Name: s.content.FolderName(native), Color: s.content.Folder.Color, CreatedAt: base}

	items := make([]domain.ContextWithCards, 0, len(phrases))
	for i, p := range phrases {
		created := base.Add(time.Duration(i) * time.Microsecond) // keeps the file's order
		translation := p.TranslationIn(native)
		exampleTr := p.ExampleTranslationIn(native)
		c := domain.Context{ID: uuid.New(), UserID: userID, SourceText: p.Word, Meaning: translation, Language: learningLang, CreatedAt: created}
		card := domain.WordCard{
			ID: uuid.New(), ContextID: c.ID, UserID: userID, Word: p.Word, Language: learningLang, CreatedAt: created,
			Translation: translation, Transcription: p.Transcription,
			ExampleSentence: p.Example, ExampleTranslation: exampleTr,
			FolderID:            &folder.ID,
			TranslationLanguage: ptrString(native), ExampleTranslationLanguage: ptrString(native),
			PartOfSpeech: ptrString(StarterPartOfSpeech),
			Paused:       true,
		}
		items = append(items, domain.ContextWithCards{Context: c, Cards: []domain.WordCard{card}})
	}
	if err := s.store.CreateFolderWithContexts(ctx, folder, items); err != nil {
		return fmt.Errorf("create the starter folder: %w", err)
	}
	return nil
}
