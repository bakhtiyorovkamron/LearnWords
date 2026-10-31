package service

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"math/rand"
	"strings"
	"time"
	"unicode"

	"github.com/google/uuid"

	"learnwords/internal/domain"
)

// StoryGenerator produces a story in the user's learning language (domain.LangFrom(ctx)) from a list of words.
type StoryGenerator interface {
	GenerateStory(ctx context.Context, words []domain.StoryWord, genre string) (domain.GeneratedStory, error)
}

// StoryTranslator translates an already-generated story (+ a gloss per word) into a native
// language. nil → translation is disabled (no AI key); the story is still shown, just without
// StoryTranslation/word glosses filled in — never a guess in the wrong language.
type StoryTranslator interface {
	TranslateStory(ctx context.Context, learningLang, nativeLang, storyDE string, words []string) (translation string, wordGlosses map[string]string, err error)
}

// StoryProofreader is the second AI pass over a generated story: fixes grammar (articles, cases,
// agreement) without changing the plot. One call per invocation — the retry is done here.
type StoryProofreader interface {
	ProofreadStory(ctx context.Context, title, story string, words []domain.StoryWord) (domain.ProofreadStory, error)
}

type StoryRepository interface {
	WordsAddedOn(ctx context.Context, userID uuid.UUID, day string) ([]domain.StoryWord, error)
	UsersWithWordsOn(ctx context.Context, day string) ([]uuid.UUID, error)
	// LearningLanguage is used by the cron job (no HTTP request → no language in ctx).
	LearningLanguage(ctx context.Context, userID uuid.UUID) (string, error)
	Upsert(ctx context.Context, s domain.DailyStory) (domain.DailyStory, error)
	SaveCorrections(ctx context.Context, storyID, userID uuid.UUID, cs []domain.StoryCorrection) error
	ByDate(ctx context.Context, userID uuid.UUID, day string) (domain.DailyStory, error)
	List(ctx context.Context, userID uuid.UUID, limit int) ([]domain.DailyStory, error)
	GetTranslation(ctx context.Context, storyID uuid.UUID, lang string) (domain.StoryTranslation, bool, error)
	PutTranslation(ctx context.Context, storyID uuid.UUID, lang string, tr domain.StoryTranslation) error
	DeleteTranslation(ctx context.Context, storyID uuid.UUID, lang string) error
	// FixTranslationLang sets the story's translation language when it has none (conditional: the first
	// caller wins) and returns the language in force.
	FixTranslationLang(ctx context.Context, storyID uuid.UUID, lang string) (string, error)
	// Own stories (source 'user'): written or pasted by the user.
	ByID(ctx context.Context, userID, id uuid.UUID) (domain.DailyStory, error)
	CreateOwn(ctx context.Context, s domain.DailyStory) (domain.DailyStory, error)
	UpdateOwn(ctx context.Context, userID, id uuid.UUID, title, text string) (domain.DailyStory, error)
	DeleteOwn(ctx context.Context, userID, id uuid.UUID) error
}

var StoryGenres = []string{"приключение", "детектив", "комедия", "сказка", "фантастика", "повседневная жизнь", "романтика"}

// maxStoryWords caps how many of the day's words go into one story: a long word list makes the
// answer much more likely to be cut off or malformed.
const maxStoryWords = 12

// maxStoryList caps the archive (AI and own stories together).
const maxStoryList = 500

type StoryService struct {
	repo       StoryRepository
	gen        StoryGenerator   // nil when ANTHROPIC_API_KEY is not set
	translator StoryTranslator  // nil when ANTHROPIC_API_KEY is not set
	proof      StoryProofreader // nil when ANTHROPIC_API_KEY is not set
	now        func() time.Time
}

func NewStoryService(repo StoryRepository, gen StoryGenerator, translator StoryTranslator, proof StoryProofreader) *StoryService {
	return &StoryService{repo: repo, gen: gen, translator: translator, proof: proof, now: time.Now}
}

func (s *StoryService) today() string { return s.now().UTC().Format("2006-01-02") }

// TodayWords returns the words added today (used to enable the "generate" button).
func (s *StoryService) TodayWords(ctx context.Context, userID uuid.UUID) ([]domain.StoryWord, error) {
	return s.repo.WordsAddedOn(ctx, userID, s.today())
}

// GenerateDailyStory builds a story from today's words and resolves it for display in
// nativeLang. Returns (nil, nil) when no words were added today.
func (s *StoryService) GenerateDailyStory(ctx context.Context, userID uuid.UUID, genre, nativeLang string) (*domain.DailyStory, error) {
	st, err := s.generateFor(ctx, userID, s.today(), genre, domain.NormTranslationLang(nativeLang))
	if err != nil || st == nil {
		return st, err
	}
	s.resolveTranslation(ctx, st, nativeLang)
	return st, nil
}

// generateFor is the raw learning-language generation step, shared by the HTTP-facing
// GenerateDailyStory and the daily cron (generateForAll) — neither the cron nor this helper
// resolves a translation: nobody is viewing the story the moment the cron creates it.
func (s *StoryService) generateFor(ctx context.Context, userID uuid.UUID, day, genre, translationLang string) (*domain.DailyStory, error) {
	if s.gen == nil {
		return nil, domain.ErrUnavailable
	}
	words, err := s.repo.WordsAddedOn(ctx, userID, day)
	if err != nil {
		return nil, err
	}
	if len(words) == 0 {
		return nil, nil
	}
	if len(words) > maxStoryWords {
		// Random sample, so every word gets a chance across regenerations.
		rand.Shuffle(len(words), func(i, j int) { words[i], words[j] = words[j], words[i] })
		words = words[:maxStoryWords]
	}
	genre = strings.TrimSpace(genre)
	if genre == "" {
		genre = StoryGenres[rand.Intn(len(StoryGenres))]
	}
	if len([]rune(genre)) > 50 {
		return nil, fmt.Errorf("%w: genre too long", domain.ErrValidation)
	}
	g, err := s.gen.GenerateStory(ctx, words, genre)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", domain.ErrUpstream, err)
	}
	// Proofread BEFORE saving: what is stored (and later translated) is the corrected text.
	st := domain.DailyStory{UserID: userID, Date: day, Genre: genre, Title: g.Title, StoryDE: g.StoryDE, WordsUsed: words, TranslationLang: translationLang}
	corrections := s.proofread(ctx, &st)
	saved, err := s.repo.Upsert(ctx, st)
	if err != nil {
		return nil, fmt.Errorf("save story: %w", err)
	}
	if err := s.repo.SaveCorrections(ctx, saved.ID, userID, corrections); err != nil {
		slog.WarnContext(ctx, "save story corrections failed", "story", saved.ID, "err", err)
	}
	return &saved, nil
}

const proofreadTries = 2 // first call + one retry

// proofread replaces st's title/text with the proofread version and records the forms each word
// has in the text. If both attempts fail (timeout, invalid JSON, a suspicious answer), the
// original text is kept and the failure is logged — the story is still shown.
func (s *StoryService) proofread(ctx context.Context, st *domain.DailyStory) []domain.StoryCorrection {
	if s.proof == nil {
		st.ProofreadStatus = domain.ProofreadNone
		return nil
	}
	var lastErr error
	for try := 1; try <= proofreadTries; try++ {
		p, err := s.proof.ProofreadStory(ctx, st.Title, st.StoryDE, st.WordsUsed)
		if err == nil {
			err = validateProofread(st.StoryDE, p)
		}
		if err == nil {
			if p.Title != "" {
				st.Title = p.Title
			}
			st.StoryDE = p.Text
			st.ProofreadStatus = domain.ProofreadChecked
			applyWordForms(st.WordsUsed, p.WordForms, p.Text)
			slog.InfoContext(ctx, "story proofread", "corrections", len(p.Corrections), "try", try)
			return p.Corrections
		}
		lastErr = err
		slog.WarnContext(ctx, "story proofread attempt failed", "try", try, "err", err)
		if ctx.Err() != nil {
			break
		}
	}
	slog.ErrorContext(ctx, "story proofread failed, showing the original text", "err", lastErr)
	st.ProofreadStatus = domain.ProofreadFailed
	return nil
}

// validateProofread rejects answers that are clearly not "the same story, corrected": empty,
// in another script, much shorter/longer, or with highlighted words dropped.
func validateProofread(original string, p domain.ProofreadStory) error {
	if p.Text == "" {
		return errors.New("proofread text is empty")
	}
	if hasCyrillic(p.Text) || hasCyrillic(p.Title) {
		return errors.New("proofread text contains Cyrillic characters")
	}
	if n, o := len([]rune(p.Text)), len([]rune(original)); n*10 < o*7 || n*10 > o*13 {
		return fmt.Errorf("proofread text length changed too much (%d → %d)", o, n)
	}
	if strings.Count(p.Text, "**")/2 < strings.Count(original, "**")/2 {
		return errors.New("proofread text lost highlighted words")
	}
	return nil
}

func hasCyrillic(s string) bool {
	for _, r := range s {
		if unicode.Is(unicode.Cyrillic, r) {
			return true
		}
	}
	return false
}

// applyWordForms stores, per word, the spellings it has in the text (only ones that really occur).
// Keys are matched against how the word was given to the model (article + lemma), the lemma and the saved text.
func applyWordForms(words []domain.StoryWord, forms map[string][]string, text string) {
	if len(forms) == 0 {
		return
	}
	lower := make(map[string][]string, len(forms))
	for k, v := range forms {
		lower[strings.ToLower(strings.TrimSpace(k))] = v
	}
	plain := strings.ToLower(strings.ReplaceAll(text, "**", ""))
	for i := range words {
		w := &words[i]
		var found []string
		for _, key := range []string{w.PromptForm(), w.Lemma, w.Word} {
			if f, ok := lower[strings.ToLower(strings.TrimSpace(key))]; ok && key != "" {
				found = f
				break
			}
		}
		w.Forms = nil
		seen := map[string]bool{}
		for _, f := range found {
			f = strings.TrimSpace(strings.Trim(f, "*"))
			lf := strings.ToLower(f)
			if f == "" || seen[lf] || !strings.Contains(plain, lf) || len(w.Forms) >= 6 {
				continue
			}
			seen[lf] = true
			w.Forms = append(w.Forms, f)
		}
	}
}

// ByDate returns a story for a given date (YYYY-MM-DD; empty means today), resolved for
// display in nativeLang.
func (s *StoryService) ByDate(ctx context.Context, userID uuid.UUID, day, nativeLang string) (*domain.DailyStory, error) {
	if day == "" {
		day = s.today()
	}
	if _, err := time.Parse("2006-01-02", day); err != nil {
		return nil, fmt.Errorf("%w: date must be YYYY-MM-DD", domain.ErrValidation)
	}
	st, err := s.repo.ByDate(ctx, userID, day)
	if err != nil {
		return nil, err
	}
	s.resolveTranslation(ctx, &st, nativeLang)
	return &st, nil
}

// resolveTranslation fills st.StoryTranslation and each WordsUsed[].Translation in the story's ONE
// translation language: st.TranslationLang when it is set, otherwise the requested language — which
// is then fixed on the story (first open), so later requests for another interface language neither
// change it nor trigger a new translation. A cached translation is used if one exists, otherwise it
// is generated via AI and cached. A cache miss with
// no translator configured, or a failed generation, just leaves the translation empty — the
// German text is still shown; it is never silently replaced with the wrong language.
func (s *StoryService) resolveTranslation(ctx context.Context, st *domain.DailyStory, requested string) {
	nativeLang := st.TranslationLang
	if nativeLang == "" {
		nativeLang = domain.NormTranslationLang(requested)
		if fixed, err := s.repo.FixTranslationLang(ctx, st.ID, nativeLang); err == nil && fixed != "" {
			nativeLang = fixed // a parallel first open may have fixed another language: it wins
		} else if err != nil {
			slog.WarnContext(ctx, "story translation language not saved", "story", st.ID, "err", err)
		}
		st.TranslationLang = nativeLang
	}
	st.Language = nativeLang
	st.TranslationSource = ""
	// WordsUsed is stored with whatever language was active when the words were first added —
	// not necessarily nativeLang. Blank it out up front so a cache miss (or a failed AI call,
	// with no translator configured) leaves every gloss empty instead of silently showing that
	// stale, possibly-wrong-language value.
	for i := range st.WordsUsed {
		st.WordsUsed[i].Translation = ""
	}

	if tr, ok, err := s.repo.GetTranslation(ctx, st.ID, nativeLang); err == nil && ok {
		st.StoryTranslation = tr.Translation
		st.TranslationSource = tr.Source
		if st.TranslationSource == "" {
			st.TranslationSource = domain.StorySourceAI
		}
		applyGlosses(st.WordsUsed, tr.WordGlosses)
		return
	} else if err != nil {
		slog.WarnContext(ctx, "story translation cache read failed", "story", st.ID, "err", err)
	}
	if s.translator == nil {
		return
	}

	words := make([]string, len(st.WordsUsed))
	for i, w := range st.WordsUsed {
		words[i] = w.Word
	}
	tr, glosses, err := s.translator.TranslateStory(ctx, domain.LangFrom(ctx), nativeLang, st.StoryDE, words)
	if err != nil {
		slog.WarnContext(ctx, "story translation failed", "story", st.ID, "lang", nativeLang, "err", err)
		return
	}
	if err := s.repo.PutTranslation(ctx, st.ID, nativeLang,
		domain.StoryTranslation{Translation: tr, WordGlosses: glosses, Source: domain.StorySourceAI}); err != nil {
		slog.WarnContext(ctx, "story translation cache write failed", "story", st.ID, "err", err)
	}
	st.StoryTranslation = tr
	st.TranslationSource = domain.StorySourceAI
	applyGlosses(st.WordsUsed, glosses)
}

// applyGlosses overwrites each word's Translation with its gloss for the currently requested
// native language (case-insensitive match on the word spelling).
func applyGlosses(words []domain.StoryWord, glosses map[string]string) {
	if len(glosses) == 0 {
		return
	}
	lower := make(map[string]string, len(glosses))
	for k, v := range glosses {
		lower[strings.ToLower(strings.TrimSpace(k))] = v
	}
	for i := range words {
		if g, ok := lower[strings.ToLower(strings.TrimSpace(words[i].Word))]; ok && g != "" {
			words[i].Translation = g
		}
	}
}

func (s *StoryService) List(ctx context.Context, userID uuid.UUID) ([]domain.DailyStory, error) {
	return s.repo.List(ctx, userID, maxStoryList)
}

// RunScheduler generates stories once a day at hour:00 (in loc) for every user who added
// words that day and has no story yet. Blocks until ctx is cancelled.
func (s *StoryService) RunScheduler(ctx context.Context, hour int, loc *time.Location) {
	if s.gen == nil {
		return
	}
	for {
		now := time.Now().In(loc)
		next := time.Date(now.Year(), now.Month(), now.Day(), hour, 0, 0, 0, loc)
		if !next.After(now) {
			next = next.Add(24 * time.Hour)
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(time.Until(next)):
		}
		s.generateForAll(ctx, next.UTC().Format("2006-01-02"))
	}
}

func (s *StoryService) generateForAll(ctx context.Context, day string) {
	users, err := s.repo.UsersWithWordsOn(ctx, day)
	if err != nil {
		slog.Error("daily story cron: list users", "err", err)
		return
	}
	slog.Info("daily story cron started", "date", day, "users", len(users))
	for _, uid := range users {
		// Up to 3 attempts per story inside the generator.
		c, cancel := context.WithTimeout(ctx, 7*time.Minute)
		lang, err := s.repo.LearningLanguage(c, uid)
		if err != nil {
			slog.Warn("daily story cron: learning language", "user", uid, "err", err)
			lang = domain.DefaultLearningLang
		}
		c = domain.WithLang(c, lang)
		// No translation here: nobody is viewing the story the moment the cron creates it —
		// resolveTranslation runs lazily the first time a user actually opens it.
		if _, err := s.generateFor(c, uid, day, "", ""); err != nil {
			slog.Warn("daily story cron: generation failed", "user", uid, "err", err)
		}
		cancel()
		if ctx.Err() != nil {
			return
		}
	}
}
