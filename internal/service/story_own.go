package service

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"unicode"

	"github.com/google/uuid"

	"learnwords/internal/domain"
)

// Limits of an own story (in runes).
const (
	ownTextMin        = 10
	ownTextMax        = 4000
	ownTitleMax       = 120
	ownAutoTitleMax   = 60
	ownTranslationMax = 8000
	// A text that is more than this share Cyrillic is not in the learning language.
	ownCyrillicShare = 0.30
)

// cyrillicShare: the share of letters that are Cyrillic (0 for a text without letters).
func cyrillicShare(s string) float64 {
	letters, cyr := 0, 0
	for _, r := range s {
		if !unicode.IsLetter(r) {
			continue
		}
		letters++
		if unicode.Is(unicode.Cyrillic, r) {
			cyr++
		}
	}
	if letters == 0 {
		return 0
	}
	return float64(cyr) / float64(letters)
}

func normalizeNewlines(s string) string {
	s = strings.ReplaceAll(s, "\r\n", "\n")
	return strings.ReplaceAll(s, "\r", "\n")
}

// autoTitle: the first non-empty line of the text without ** markers, cut at a word boundary to
// at most ownAutoTitleMax runes — "…" is added only when something was cut.
func autoTitle(text string) string {
	line := ""
	for _, l := range strings.Split(text, "\n") {
		if l = strings.TrimSpace(strings.ReplaceAll(l, "**", "")); l != "" {
			line = l
			break
		}
	}
	r := []rune(line)
	if len(r) <= ownAutoTitleMax {
		return line
	}
	cut := ownAutoTitleMax
	if !unicode.IsSpace(r[cut]) { // the limit falls inside a word: back up to the previous space
		if i := lastSpace(r[:cut]); i > 0 {
			cut = i
		}
	}
	return strings.TrimRight(strings.TrimSpace(string(r[:cut])), ",;:-–—") + "…"
}

func lastSpace(r []rune) int {
	for i := len(r) - 1; i >= 0; i-- {
		if unicode.IsSpace(r[i]) {
			return i
		}
	}
	return -1
}

// validateOwn checks and normalizes an own story: trimmed, \r\n → \n, title filled in when empty.
func validateOwn(in domain.OwnStoryInput) (domain.OwnStoryInput, error) {
	bad := func(format string, a ...any) (domain.OwnStoryInput, error) {
		return in, fmt.Errorf("%w: %s", domain.ErrValidation, fmt.Sprintf(format, a...))
	}
	in.Title = strings.TrimSpace(in.Title)
	in.Text = strings.TrimSpace(normalizeNewlines(in.Text))
	in.Translation = strings.TrimSpace(normalizeNewlines(in.Translation))

	if n := len([]rune(in.Text)); n < ownTextMin || n > ownTextMax {
		return bad("text must be %d-%d characters", ownTextMin, ownTextMax)
	}
	if cyrillicShare(in.Text) > ownCyrillicShare {
		return bad("text must be in the learning language")
	}
	if len([]rune(in.Title)) > ownTitleMax {
		return bad("title must be at most %d characters", ownTitleMax)
	}
	if in.Title == "" {
		if in.Title = autoTitle(in.Text); in.Title == "" {
			return bad("title is required")
		}
	}
	switch in.TranslationMode {
	case domain.TranslationAuto:
		in.Translation = ""
	case domain.TranslationManual:
		if in.Translation == "" {
			return bad("translation is required")
		}
		if len([]rune(in.Translation)) > ownTranslationMax {
			return bad("translation must be at most %d characters", ownTranslationMax)
		}
	default:
		return bad("translation_mode must be auto or manual")
	}
	return in, nil
}

// CreateOwnStory saves a story the user pasted or wrote, with their own translation (manual) or
// one made by AI right now (auto). With AI unavailable, an auto story is refused BEFORE anything
// is saved. If the AI call fails after saving, the story stays without a translation and the next
// view retries — same as AI stories.
func (s *StoryService) CreateOwnStory(ctx context.Context, userID uuid.UUID, in domain.OwnStoryInput, nativeLang string) (*domain.DailyStory, error) {
	in, err := validateOwn(in)
	if err != nil {
		return nil, err
	}
	nativeLang = domain.NormTranslationLang(nativeLang)
	if in.TranslationMode == domain.TranslationAuto && s.translator == nil {
		return nil, domain.ErrUnavailable
	}
	st, err := s.repo.CreateOwn(ctx, domain.DailyStory{UserID: userID, Date: s.today(), Title: in.Title, StoryDE: in.Text})
	if err != nil {
		return nil, fmt.Errorf("save story: %w", err)
	}
	if in.TranslationMode == domain.TranslationManual {
		if err := s.putUserTranslation(ctx, st.ID, nativeLang, in.Translation); err != nil {
			if derr := s.repo.DeleteOwn(ctx, userID, st.ID); derr != nil { // don't leave a half-made story
				slog.WarnContext(ctx, "cleanup of a half-created own story failed", "story", st.ID, "err", derr)
			}
			return nil, fmt.Errorf("save translation: %w", err)
		}
	}
	s.resolveTranslation(ctx, &st, nativeLang)
	return &st, nil
}

func (s *StoryService) putUserTranslation(ctx context.Context, storyID uuid.UUID, lang, translation string) error {
	return s.repo.PutTranslation(ctx, storyID, lang, domain.StoryTranslation{
		Translation: translation, WordGlosses: map[string]string{}, Source: domain.StorySourceUser,
	})
}

// UpdateOwnStory edits an own story. An AI story is ErrNotFound. The cached translations of the old
// text are dropped when the text changed (by the repository). Then:
//   - manual → the given translation becomes the user's translation for nativeLang;
//   - auto → the user's translation (if that is what is cached) is dropped and AI translates; an
//     AI translation that is already cached is kept, so a title-only edit makes no AI call.
func (s *StoryService) UpdateOwnStory(ctx context.Context, userID, id uuid.UUID, in domain.OwnStoryInput, nativeLang string) (*domain.DailyStory, error) {
	in, err := validateOwn(in)
	if err != nil {
		return nil, err
	}
	nativeLang = domain.NormTranslationLang(nativeLang)
	cur, err := s.repo.ByID(ctx, userID, id)
	if err != nil {
		return nil, err
	}
	if cur.Source != domain.StorySourceUser {
		return nil, domain.ErrNotFound
	}
	textChanged := cur.StoryDE != in.Text
	var cached domain.StoryTranslation
	var hasCache bool
	if in.TranslationMode == domain.TranslationAuto {
		cached, hasCache, _ = s.repo.GetTranslation(ctx, id, nativeLang)
		needAI := textChanged || !hasCache || cached.Source != domain.StorySourceAI
		if needAI && s.translator == nil {
			return nil, domain.ErrUnavailable // refused before anything changes
		}
	}
	st, err := s.repo.UpdateOwn(ctx, userID, id, in.Title, in.Text)
	if err != nil {
		return nil, err
	}
	switch in.TranslationMode {
	case domain.TranslationManual:
		if err := s.putUserTranslation(ctx, id, nativeLang, in.Translation); err != nil {
			return nil, fmt.Errorf("save translation: %w", err)
		}
	case domain.TranslationAuto:
		if !textChanged && hasCache && cached.Source == domain.StorySourceUser {
			if err := s.repo.DeleteTranslation(ctx, id, nativeLang); err != nil {
				return nil, fmt.Errorf("drop the user's translation: %w", err)
			}
		}
	}
	s.resolveTranslation(ctx, &st, nativeLang)
	return &st, nil
}

// DeleteOwnStory removes an own story; an AI story is ErrNotFound.
func (s *StoryService) DeleteOwnStory(ctx context.Context, userID, id uuid.UUID) error {
	return s.repo.DeleteOwn(ctx, userID, id)
}

// ByID returns one of the user's stories (AI or own), resolved for display in nativeLang.
func (s *StoryService) ByID(ctx context.Context, userID, id uuid.UUID, nativeLang string) (*domain.DailyStory, error) {
	st, err := s.repo.ByID(ctx, userID, id)
	if err != nil {
		return nil, err
	}
	s.resolveTranslation(ctx, &st, nativeLang)
	return &st, nil
}
