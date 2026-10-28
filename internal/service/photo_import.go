package service

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"strings"

	"github.com/google/uuid"

	"learnwords/internal/domain"
)

// MaxPhotoBytes is the largest image accepted (the AI's own limit for an image is 5 MB).
const MaxPhotoBytes = 5 << 20

// maxPhotoWords: the answer is cut to this many words.
const maxPhotoWords = 50

// PhotoReader reads the vocabulary off an image. The learning and translation languages come from ctx.
type PhotoReader interface {
	ExtractPhotoWords(ctx context.Context, image []byte, mediaType string) ([]domain.PhotoWord, error)
}

// PhotoQuota is the user's daily photo quota (FeatureService).
type PhotoQuota interface {
	Consume(ctx context.Context, userID uuid.UUID, feature string, n int) (*int, error)
	Refund(ctx context.Context, userID uuid.UUID, feature string, n int) error
}

type PhotoImportService struct {
	ai    PhotoReader // nil → no API key
	words WordExistence
	quota PhotoQuota
}

func NewPhotoImportService(ai PhotoReader, words WordExistence, quota PhotoQuota) *PhotoImportService {
	return &PhotoImportService{ai: ai, words: words, quota: quota}
}

var photoTypes = map[string]bool{"image/jpeg": true, "image/png": true, "image/webp": true, "image/gif": true}

// Import reads the words off a photo. One photo = one unit of the user's daily photo_import quota,
// taken just before the AI call and given back if that call fails. Everything that can be refused
// without the AI (bad image, no API key, feature off, limit reached) happens before any AI cost.
func (s *PhotoImportService) Import(ctx context.Context, userID uuid.UUID, image []byte) (*domain.PhotoImportResult, error) {
	if len(image) == 0 {
		return nil, fmt.Errorf("%w: image is empty", domain.ErrValidation)
	}
	if len(image) > MaxPhotoBytes {
		return nil, fmt.Errorf("%w: image is larger than %d MB", domain.ErrValidation, MaxPhotoBytes>>20)
	}
	mediaType := http.DetectContentType(image)
	if !photoTypes[mediaType] {
		return nil, fmt.Errorf("%w: image must be JPEG, PNG, WebP or GIF", domain.ErrValidation)
	}
	if s.ai == nil {
		return nil, domain.ErrUnavailable
	}

	remaining, err := s.quota.Consume(ctx, userID, domain.FeaturePhotoImport, 1)
	if err != nil {
		return nil, err
	}
	found, err := s.ai.ExtractPhotoWords(ctx, image, mediaType)
	if err != nil {
		if rerr := s.quota.Refund(context.WithoutCancel(ctx), userID, domain.FeaturePhotoImport, 1); rerr != nil {
			slog.ErrorContext(ctx, "photo import: refund failed", "user_id", userID, "err", rerr)
		}
		return nil, fmt.Errorf("%w: %v", domain.ErrUpstream, err)
	}

	words, err := s.clean(ctx, userID, found)
	if err != nil {
		return nil, err
	}
	slog.InfoContext(ctx, "photo-import", "user_id", userID, "found", len(found), "words", len(words))
	return &domain.PhotoImportResult{Words: words, Remaining: remaining}, nil
}

// clean trims the AI's list: drops entries without a word or translation and duplicates, caps the
// length, fills FullWord and marks the words the user already has.
func (s *PhotoImportService) clean(ctx context.Context, userID uuid.UUID, found []domain.PhotoWord) ([]domain.PhotoWord, error) {
	out := make([]domain.PhotoWord, 0, len(found))
	seen := map[string]bool{}
	for _, w := range found {
		w.Word = strings.Join(strings.Fields(w.Word), " ")
		w.Translation = strings.Join(strings.Fields(w.Translation), " ")
		if w.Article != nil {
			if a := strings.TrimSpace(*w.Article); a == "" || w.WordType != "noun" {
				w.Article = nil
			} else {
				w.Article = &a
			}
		}
		if w.Word == "" || w.Translation == "" || len([]rune(w.Word)) > 100 || len([]rune(w.Translation)) > 500 {
			continue
		}
		w.FullWord = w.Full()
		key := strings.ToLower(w.FullWord)
		if seen[key] {
			continue
		}
		seen[key] = true
		has, err := s.words.HasWord(ctx, userID, w.FullWord, w.Word)
		if err != nil {
			return nil, err
		}
		w.AlreadyAdded = has
		out = append(out, w)
		if len(out) == maxPhotoWords {
			break
		}
	}
	return out, nil
}
