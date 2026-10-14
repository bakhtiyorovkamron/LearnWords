package service

import (
	"context"
	"fmt"
	"log/slog"
	"strings"

	"learnwords/internal/domain"
)

// WordChecker asks AI about one word; the answer is validated here, not trusted as is.
type WordChecker interface {
	CheckWord(ctx context.Context, input, nativeLang string) (domain.WordCheck, error)
}

// WordCheckCache stores validated results by key (nil → no caching).
type WordCheckCache interface {
	Get(ctx context.Context, key string) (domain.WordCheck, bool, error)
	Put(ctx context.Context, key string, w domain.WordCheck) error
}

const (
	maxCheckTextLen = 100
	// wordCheckVersion is bumped whenever the prompt/validation changes (old keys just stop matching).
	wordCheckVersion = "v1"
	wordCheckTries   = 2 // first call + one retry when the answer fails validation
)

type WordCheckService struct {
	ai    WordChecker // nil → feature disabled (no API key)
	cache WordCheckCache
}

func NewWordCheckService(ai WordChecker, cache WordCheckCache) *WordCheckService {
	return &WordCheckService{ai: ai, cache: cache}
}

// Enabled reports whether checks can be made at all.
func (s *WordCheckService) Enabled() bool { return s != nil && s.ai != nil }

// WordCheckKey: "v1:de:ru:Sfit". Spaces collapsed but case kept — "essen" (verb) and "Essen"
// (noun) are different words, and a lower-case noun is itself a mistake to report.
func WordCheckKey(learningLang, nativeLang, text string) string {
	return wordCheckVersion + ":" + domain.Lang(learningLang).Code + ":" +
		domain.NormTranslationLang(nativeLang) + ":" + domain.CollapseSpaces(text)
}

// Check validates text (a German word or phrase). The same (text, native language) is sent to
// AI only once — later checks come from the cache. An AI answer that fails validation is
// retried once; after that (or on an AI error) the result is "unknown", so adding a word never
// breaks because of the check. Such fallback results are not cached.
func (s *WordCheckService) Check(ctx context.Context, text, nativeLang string) (domain.WordCheck, error) {
	text = domain.CollapseSpaces(text)
	if text == "" || len([]rune(text)) > maxCheckTextLen {
		return domain.WordCheck{}, fmt.Errorf("%w: text must be 1-%d characters", domain.ErrValidation, maxCheckTextLen)
	}
	learning := domain.LangFrom(ctx)
	if learning != "de" {
		return domain.WordCheck{}, fmt.Errorf("%w: word check is available only for German", domain.ErrValidation)
	}
	if !s.Enabled() {
		return domain.WordCheck{}, domain.ErrUnavailable
	}
	nativeLang = domain.NormTranslationLang(nativeLang)
	key := WordCheckKey(learning, nativeLang, text)

	if s.cache != nil {
		w, hit, err := s.cache.Get(ctx, key)
		if err != nil {
			slog.WarnContext(ctx, "word check cache get failed", "key", key, "err", err) // must not break the check
		} else if hit {
			w.Input = text
			return w, nil
		}
	}

	var lastErr error
	for try := 1; try <= wordCheckTries; try++ {
		raw, err := s.ai.CheckWord(ctx, text, nativeLang)
		if err == nil {
			var w domain.WordCheck
			if w, err = domain.NormalizeWordCheck(raw, text); err == nil {
				if s.cache != nil {
					if err := s.cache.Put(context.WithoutCancel(ctx), key, w); err != nil {
						slog.WarnContext(ctx, "word check cache put failed", "key", key, "err", err)
					}
				}
				slog.InfoContext(ctx, "word check", "key", key, "status", w.Status, "try", try)
				return w, nil
			}
		}
		lastErr = err
		slog.WarnContext(ctx, "word check attempt failed", "key", key, "try", try, "err", err)
		if ctx.Err() != nil {
			break
		}
	}
	slog.ErrorContext(ctx, "word check failed, answering unknown", "key", key, "err", lastErr)
	return domain.WordCheck{Status: domain.CheckUnknown, Input: text}, nil
}

// isCheckable: words the admin job sends to the check — not "der Samstag / der Sonnabend"
// variants and nothing longer than a check accepts.
func isCheckable(word string) bool {
	word = domain.CollapseSpaces(word)
	return word != "" && !strings.Contains(word, " / ") && len([]rune(word)) <= maxCheckTextLen
}
