package service

import (
	"context"
	"fmt"
	"net/url"
	"strings"
	"time"
	"unicode"

	"github.com/google/uuid"

	"learnwords/internal/domain"
)

const photoSearchTimeout = 6 * time.Second

// photoQueries builds search queries from a German phrase, most specific first.
// German nouns are capitalized, so they are the best keywords for a picture.
func photoQueries(text string) []string {
	// Phrases about time/dates get precise English visual keywords (clock, calendar, sunset…).
	if tq := timeQueries(text); len(tq) > 0 {
		return tq
	}
	words := Tokenize(text, "de")
	var nouns []string
	for _, w := range words {
		if r := []rune(w); len(r) > 2 && unicode.IsUpper(r[0]) {
			nouns = append(nouns, w)
		}
	}
	var qs []string
	if len(nouns) >= 2 {
		qs = append(qs, nouns[0]+" "+nouns[1])
	}
	qs = append(qs, nouns...)
	if len(qs) == 0 && len(words) > 0 {
		qs = append(qs, words[0])
	}
	if len(qs) > 3 {
		qs = qs[:3]
	}
	return qs
}

// findPhotos tries queries in order and returns the first non-empty result set.
func (s *ContextService) findPhotos(ctx context.Context, text string, limit int) ([]domain.Photo, error) {
	if s.p.Images == nil {
		return nil, nil
	}
	ctx, cancel := context.WithTimeout(ctx, photoSearchTimeout)
	defer cancel()

	var lastErr error
	for _, q := range photoQueries(text) {
		photos, err := s.p.Images.Search(ctx, q, limit)
		if err != nil {
			lastErr = err
			continue
		}
		if len(photos) > 0 {
			return photos, nil
		}
	}
	return nil, lastErr
}

// SearchPhotos returns photo candidates for a context. A custom query overrides auto keywords.
func (s *ContextService) SearchPhotos(ctx context.Context, userID, contextID uuid.UUID, query string) ([]domain.Photo, error) {
	ctx, span := tracer.Start(ctx, "ContextService.SearchPhotos")
	defer span.End()

	c, err := s.contexts.GetByID(ctx, userID, contextID)
	if err != nil {
		return nil, err
	}
	if s.p.Images == nil {
		return []domain.Photo{}, nil
	}

	query = strings.TrimSpace(query)
	var photos []domain.Photo
	if query != "" {
		if len([]rune(query)) > 100 {
			return nil, fmt.Errorf("%w: query too long", domain.ErrValidation)
		}
		sctx, cancel := context.WithTimeout(ctx, photoSearchTimeout)
		defer cancel()
		photos, err = s.p.Images.Search(sctx, query, 12)
	} else {
		photos, err = s.findPhotos(ctx, c.SourceText, 12)
	}
	if err != nil {
		return nil, s.fail(span, "search photos", err)
	}
	if photos == nil {
		photos = []domain.Photo{}
	}
	return photos, nil
}

func (s *ContextService) SetPhoto(ctx context.Context, userID, contextID uuid.UUID, photoURL, credit string) error {
	u, err := url.Parse(photoURL)
	if err != nil || u.Scheme != "https" || u.Host == "" || len(photoURL) > 2048 {
		return fmt.Errorf("%w: photo url must be a valid https URL", domain.ErrValidation)
	}
	if len([]rune(credit)) > 500 {
		credit = string([]rune(credit)[:500])
	}
	return s.contexts.UpdatePhoto(ctx, userID, contextID, photoURL, strings.TrimSpace(credit))
}
