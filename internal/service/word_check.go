package service

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"unicode"

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
	wordCheckVersion = "v2"
	wordCheckTries   = 2 // first call + one retry when the answer fails validation
)

// WordDictionary is the word-search cache, read-only: the check trusts what the search knows.
type WordDictionary interface {
	Get(ctx context.Context, query string) (domain.WordInfo, bool, error)
}

type WordCheckService struct {
	ai    WordChecker // nil → feature disabled (no API key)
	cache WordCheckCache
	dict  WordDictionary // nil → AI only
}

func NewWordCheckService(ai WordChecker, cache WordCheckCache, dict WordDictionary) *WordCheckService {
	return &WordCheckService{ai: ai, cache: cache, dict: dict}
}

// Enabled reports whether checks can be made at all.
func (s *WordCheckService) Enabled() bool { return s != nil && s.ai != nil }

// WordCheckKey: "v2:de:ru:Sfit". Spaces collapsed but case kept — "essen" (verb) and "Essen"
// (noun) are different words, and a lower-case noun is itself a mistake to report.
func WordCheckKey(learningLang, nativeLang, text string) string {
	return wordCheckVersion + ":" + domain.Lang(learningLang).Code + ":" +
		domain.NormTranslationLang(nativeLang) + ":" + domain.CollapseSpaces(text)
}

// Check validates text (a German word or phrase). Order: the search dictionary (the same cache
// the word search uses — a word the search knows is never "unknown"), then the check cache, then
// AI. An AI answer that fails validation is retried once; if it still fails the status is
// "error" (the client stays silent). "unknown" means AI confidently said the word does not
// exist. Neither "unknown" nor "error" is cached.
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

	if w, ok := s.fromDictionary(ctx, learning, nativeLang, text); ok {
		slog.InfoContext(ctx, "word check", "key", key, "status", w.Status, "source", "dictionary")
		return w, nil
	}
	if s.cache != nil {
		w, hit, err := s.cache.Get(ctx, key)
		if err != nil {
			slog.WarnContext(ctx, "word check cache get failed", "key", key, "err", err) // must not break the check
		} else if hit && (w.Status == domain.CheckOK || w.Status == domain.CheckCorrected) {
			w.Input = text
			return w, nil
		}
	}

	failed := domain.WordCheck{Status: domain.CheckError, Input: text}
	w, err := s.askAI(ctx, key, nativeLang, text, text)
	if err != nil {
		return failed, nil
	}
	// A single word AI does not know may still exist in another case ("Langsam" → "langsam",
	// "tisch" → "Tisch"). The variant's answer is judged against what the user typed, so it
	// comes out as "corrected".
	if w.Status == domain.CheckUnknown && !strings.Contains(text, " ") {
		for _, v := range caseVariants(text) {
			vw, err := s.askAI(ctx, key, nativeLang, v, text)
			if err != nil {
				break // best effort: the first answer was confident, keep it
			}
			if vw.Status != domain.CheckUnknown {
				w = vw
				break
			}
		}
	}
	if (w.Status == domain.CheckOK || w.Status == domain.CheckCorrected) && s.cache != nil {
		if err := s.cache.Put(context.WithoutCancel(ctx), key, w); err != nil {
			slog.WarnContext(ctx, "word check cache put failed", "key", key, "err", err)
		}
	}
	slog.InfoContext(ctx, "word check", "key", key, "status", w.Status, "source", "ai")
	return w, nil
}

// askAI sends ask to AI (up to wordCheckTries times) and judges the validated answer against
// input, the text the user typed.
func (s *WordCheckService) askAI(ctx context.Context, key, nativeLang, ask, input string) (domain.WordCheck, error) {
	var lastErr error
	for try := 1; try <= wordCheckTries; try++ {
		raw, err := s.ai.CheckWord(ctx, ask, nativeLang)
		if err == nil {
			var w domain.WordCheck
			if w, err = domain.NormalizeWordCheck(raw, input); err == nil {
				return w, nil
			}
		}
		lastErr = err
		slog.WarnContext(ctx, "word check attempt failed", "key", key, "ask", ask, "try", try, "err", err)
		if ctx.Err() != nil {
			break
		}
	}
	slog.ErrorContext(ctx, "word check failed, answering error", "key", key, "err", lastErr)
	return domain.WordCheck{}, lastErr
}

// fromDictionary answers from the word-search cache (case-insensitive, like the search itself).
func (s *WordCheckService) fromDictionary(ctx context.Context, learning, nativeLang, text string) (domain.WordCheck, bool) {
	if s.dict == nil {
		return domain.WordCheck{}, false
	}
	info, hit, err := s.dict.Get(ctx, SearchCacheKey(learning, nativeLang, text))
	if err != nil {
		slog.WarnContext(ctx, "word check dictionary get failed", "text", text, "err", err)
		return domain.WordCheck{}, false
	}
	if !hit || (info.QueryLanguage != "" && info.QueryLanguage != "de") {
		return domain.WordCheck{}, false
	}
	pos := info.WordType
	if !domain.IsPartOfSpeech(pos) {
		pos = domain.PosOther
	}
	w, err := domain.NormalizeWordCheck(domain.WordCheck{
		Status: domain.CheckOK, Lemma: info.Word, Article: info.Article, Plural: info.Plural,
		PartOfSpeech: pos, Translation: info.Translation,
	}, text)
	if err != nil {
		return domain.WordCheck{}, false // incomplete entry → ask AI instead
	}
	return w, true
}

// caseVariants: the other spellings of a word's first letter, the typed one excluded.
func caseVariants(text string) []string {
	r := []rune(text)
	if len(r) == 0 {
		return nil
	}
	lower := string(unicode.ToLower(r[0])) + string(r[1:])
	upper := string(unicode.ToUpper(r[0])) + string(r[1:])
	var out []string
	for _, v := range []string{lower, upper} {
		if v != text {
			out = append(out, v)
		}
	}
	return out
}

// isCheckable: words the admin job sends to the check — not "der Samstag / der Sonnabend"
// variants and nothing longer than a check accepts.
func isCheckable(word string) bool {
	word = domain.CollapseSpaces(word)
	return word != "" && !strings.Contains(word, " / ") && len([]rune(word)) <= maxCheckTextLen
}
