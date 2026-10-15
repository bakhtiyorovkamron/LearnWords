package service

import (
	"context"
	"log/slog"
	"sync"
	"time"

	"github.com/google/uuid"

	"learnwords/internal/domain"
)

type WordFixRepository interface {
	CardsToCheck(ctx context.Context, after uuid.UUID, limit int) ([]domain.CardToCheck, error)
	CountCardsToCheck(ctx context.Context) (int, error)
	SetGrammar(ctx context.Context, cardID uuid.UUID, g domain.WordGrammar) error
	AddSuggestion(ctx context.Context, s domain.WordFix) error
	ListPending(ctx context.Context, userID uuid.UUID) ([]domain.WordFix, error)
	Accept(ctx context.Context, userID, id uuid.UUID) error
	Reject(ctx context.Context, userID, id uuid.UUID) error
}

// WordFixJobStatus is the progress of the admin job, polled by the admin page.
type WordFixJobStatus struct {
	Running     bool       `json:"running"`
	Total       int        `json:"total"`
	Processed   int        `json:"processed"`
	Suggestions int        `json:"suggestions"` // corrections found → stored for users to review
	Confirmed   int        `json:"confirmed"`   // words found correct → grammar columns filled
	Unknown     int        `json:"unknown"`
	Failed      int        `json:"failed"`
	StartedAt   *time.Time `json:"started_at"`
	FinishedAt  *time.Time `json:"finished_at"`
	Error       string     `json:"error,omitempty"`
}

// WordFixService runs "check existing words" over all saved German words and lets each user
// accept or reject the suggestions for their own words. Nothing is corrected automatically:
// a word found correct only gets its grammar columns (lemma/article/…) filled — its text stays.
type WordFixService struct {
	repo    WordFixRepository
	checker *WordCheckService

	mu     sync.Mutex
	status WordFixJobStatus
}

func NewWordFixService(repo WordFixRepository, checker *WordCheckService) *WordFixService {
	return &WordFixService{repo: repo, checker: checker}
}

func (s *WordFixService) Status() WordFixJobStatus {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.status
}

// Start launches the job in the background (one at a time). Returns false if it is already running.
func (s *WordFixService) Start(ctx context.Context) (bool, error) {
	if !s.checker.Enabled() {
		return false, domain.ErrUnavailable
	}
	s.mu.Lock()
	if s.status.Running {
		s.mu.Unlock()
		return false, nil
	}
	now := time.Now().UTC()
	s.status = WordFixJobStatus{Running: true, StartedAt: &now}
	s.mu.Unlock()

	go s.run(context.WithoutCancel(ctx))
	return true, nil
}

const (
	wordFixBatch   = 100
	wordFixWorkers = 4
)

func (s *WordFixService) run(ctx context.Context) {
	defer func() {
		now := time.Now().UTC()
		s.update(func(st *WordFixJobStatus) { st.Running, st.FinishedAt = false, &now })
	}()
	if total, err := s.repo.CountCardsToCheck(ctx); err == nil {
		s.update(func(st *WordFixJobStatus) { st.Total = total })
	}
	slog.Info("word fix job started", "total", s.Status().Total)

	after := uuid.Nil
	for {
		cards, err := s.repo.CardsToCheck(ctx, after, wordFixBatch)
		if err != nil {
			slog.Error("word fix job: list cards", "err", err)
			s.update(func(st *WordFixJobStatus) { st.Error = err.Error() })
			return
		}
		if len(cards) == 0 {
			break
		}
		after = cards[len(cards)-1].ID

		jobs := make(chan domain.CardToCheck)
		var wg sync.WaitGroup
		for i := 0; i < wordFixWorkers; i++ {
			wg.Add(1)
			go func() {
				defer wg.Done()
				for c := range jobs {
					s.checkCard(ctx, c)
				}
			}()
		}
		for _, c := range cards {
			jobs <- c
		}
		close(jobs)
		wg.Wait()
	}
	st := s.Status()
	slog.Info("word fix job finished", "processed", st.Processed, "suggestions", st.Suggestions,
		"confirmed", st.Confirmed, "unknown", st.Unknown, "failed", st.Failed)
}

func (s *WordFixService) checkCard(ctx context.Context, c domain.CardToCheck) {
	defer s.update(func(st *WordFixJobStatus) { st.Processed++ })
	if !isCheckable(c.Word) {
		return
	}
	cctx, cancel := context.WithTimeout(domain.WithLang(ctx, "de"), time.Minute)
	defer cancel()
	w, err := s.checker.Check(cctx, c.Word, c.NativeLang)
	if err != nil {
		slog.Warn("word fix job: check failed", "card", c.ID, "err", err)
		s.update(func(st *WordFixJobStatus) { st.Failed++ })
		return
	}
	switch w.Status {
	case domain.CheckOK:
		err = s.repo.SetGrammar(ctx, c.ID, *w.Grammar())
		s.update(func(st *WordFixJobStatus) { st.Confirmed++ })
	case domain.CheckCorrected:
		err = s.repo.AddSuggestion(ctx, domain.WordFix{
			UserID: c.UserID, WordID: c.ID, OriginalWord: c.Word, SuggestedWord: w.Suggestion(),
			Lemma: w.Lemma, Article: w.Article, Plural: w.Plural, PartOfSpeech: w.PartOfSpeech, Reason: w.Reason,
		})
		s.update(func(st *WordFixJobStatus) { st.Suggestions++ })
	case domain.CheckError:
		s.update(func(st *WordFixJobStatus) { st.Failed++ })
	default:
		s.update(func(st *WordFixJobStatus) { st.Unknown++ })
	}
	if err != nil {
		slog.Warn("word fix job: save result", "card", c.ID, "err", err)
	}
}

func (s *WordFixService) update(f func(*WordFixJobStatus)) {
	s.mu.Lock()
	defer s.mu.Unlock()
	f(&s.status)
}

func (s *WordFixService) ListPending(ctx context.Context, userID uuid.UUID) ([]domain.WordFix, error) {
	return s.repo.ListPending(ctx, userID)
}

func (s *WordFixService) Accept(ctx context.Context, userID, id uuid.UUID) error {
	return s.repo.Accept(ctx, userID, id)
}

func (s *WordFixService) Reject(ctx context.Context, userID, id uuid.UUID) error {
	return s.repo.Reject(ctx, userID, id)
}
