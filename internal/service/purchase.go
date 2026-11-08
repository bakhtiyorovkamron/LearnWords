package service

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"

	"learnwords/internal/domain"
)

const (
	maxPendingPurchases    = 3   // pending requests per user; the next one is ErrTooManyPending
	purchaseHistoryLimit   = 10  // the user's own requests shown on the purchase page
	adminPurchaseListLimit = 200 // requests in one admin listing
	creditNoteMax          = 500 // characters of an admin grant's note
	creditGrantMax         = 1_000_000
	purchaseNotifyTimeout  = 30 * time.Second
)

type PurchaseRepository interface {
	// Create stores a pending request; ErrTooManyPending when the user already has maxPending.
	Create(ctx context.Context, userID uuid.UUID, pack domain.Pack, maxPending int) (domain.PurchaseRequest, error)
	ListByUser(ctx context.Context, userID uuid.UUID, limit int) ([]domain.PurchaseRequest, error)
	// ListByStatus: status "" = any.
	ListByStatus(ctx context.Context, status string, limit int) ([]domain.PurchaseRequest, error)
	Cancel(ctx context.Context, userID, id uuid.UUID) error
	// Approve marks the request paid and adds its credits in one transaction.
	Approve(ctx context.Context, id, adminID uuid.UUID) (domain.PurchaseRequest, error)
	Reject(ctx context.Context, id, adminID uuid.UUID) (domain.PurchaseRequest, error)
	AdminIDs(ctx context.Context) ([]uuid.UUID, error)
}

// CreditStore changes a purchased balance and records it in the ledger.
type CreditStore interface {
	AddCredits(ctx context.Context, userID uuid.UUID, feature string, delta int, reason string, purchaseID, by *uuid.UUID, note string) (int, error)
}

// Notifier sends push notifications (PushService).
type Notifier interface {
	Enabled() bool
	SendTo(ctx context.Context, target PushTarget, title, body string) (domain.PushResult, error)
}

// PurchaseService sells packs of credits paid by a manual card transfer: the user creates a
// request, transfers the money with the request's code in the comment, and an admin approves it.
type PurchaseService struct {
	repo    PurchaseRepository
	credits CreditStore
	push    Notifier // nil = no notifications
	payment domain.PaymentInfo
	wg      sync.WaitGroup // notifications in flight
}

func NewPurchaseService(repo PurchaseRepository, credits CreditStore, push Notifier, payment domain.PaymentInfo) *PurchaseService {
	return &PurchaseService{repo: repo, credits: credits, push: push, payment: payment}
}

// Available: a card number to pay to is configured. Without one the user's purchase endpoints
// answer ErrPaymentsUnavailable (the admin's keep working, to settle what is left).
func (s *PurchaseService) Available() bool { return s.payment.CardNumber != "" }

// Overview is the purchase page: the packs, where to pay and the user's latest requests.
func (s *PurchaseService) Overview(ctx context.Context, userID uuid.UUID) (domain.PurchaseOverview, error) {
	if !s.Available() {
		return domain.PurchaseOverview{}, domain.ErrPaymentsUnavailable
	}
	reqs, err := s.repo.ListByUser(ctx, userID, purchaseHistoryLimit)
	if err != nil {
		return domain.PurchaseOverview{}, err
	}
	return domain.PurchaseOverview{Packs: domain.Packs, Payment: s.payment, Requests: reqs}, nil
}

// Create opens a pending request for a pack and tells the admins. An unknown pack is
// ErrValidation; a user with maxPendingPurchases pending requests already is ErrTooManyPending.
func (s *PurchaseService) Create(ctx context.Context, userID uuid.UUID, packID string) (domain.PurchaseRequest, error) {
	if !s.Available() {
		return domain.PurchaseRequest{}, domain.ErrPaymentsUnavailable
	}
	pack, ok := domain.PackByID(packID)
	if !ok {
		return domain.PurchaseRequest{}, fmt.Errorf("%w: unknown pack", domain.ErrValidation)
	}
	p, err := s.repo.Create(ctx, userID, pack, maxPendingPurchases)
	if err != nil {
		return domain.PurchaseRequest{}, err
	}
	s.notify(ctx, s.repo.AdminIDs,
		fmt.Sprintf("Новая заявка %s · %d фото · %s сум", p.Code, p.Amount, groupThousands(p.PriceUZS)),
		"Проверьте перевод и подтвердите заявку в админке")
	return p, nil
}

// Cancel withdraws the user's own pending request (anything else is ErrPurchaseNotFound).
func (s *PurchaseService) Cancel(ctx context.Context, userID, id uuid.UUID) error {
	if !s.Available() {
		return domain.ErrPaymentsUnavailable
	}
	return s.repo.Cancel(ctx, userID, id)
}

// List is the admin listing: status pending (also when empty), paid, rejected, cancelled or all.
func (s *PurchaseService) List(ctx context.Context, status string) ([]domain.PurchaseRequest, error) {
	switch {
	case status == "":
		status = domain.PurchasePending
	case status == "all":
		status = ""
	case !domain.IsPurchaseStatus(status):
		return nil, fmt.Errorf("%w: status must be pending, paid, rejected, cancelled or all", domain.ErrValidation)
	}
	return s.repo.ListByStatus(ctx, status, adminPurchaseListLimit)
}

// Approve: the money arrived. The request becomes paid, its credits are added (once, however
// often this is called) and the user is told.
func (s *PurchaseService) Approve(ctx context.Context, adminID, id uuid.UUID) (domain.PurchaseRequest, error) {
	p, err := s.repo.Approve(ctx, id, adminID)
	if err != nil {
		return domain.PurchaseRequest{}, err
	}
	s.notify(ctx, func(context.Context) ([]uuid.UUID, error) { return []uuid.UUID{p.UserID}, nil },
		"Фото начислены", fmt.Sprintf("+%d фото уже на счету", p.Amount))
	return p, nil
}

// Reject: no money arrived. The request becomes rejected, no credits.
func (s *PurchaseService) Reject(ctx context.Context, adminID, id uuid.UUID) (domain.PurchaseRequest, error) {
	return s.repo.Reject(ctx, id, adminID)
}

// Grant is an admin correction of a user's balance (amount may be negative, never below 0 in
// total). Returns the new balance.
func (s *PurchaseService) Grant(ctx context.Context, adminID, userID uuid.UUID, feature string, amount int, note string) (int, error) {
	if !domain.IsFeature(feature) {
		return 0, fmt.Errorf("%w: unknown feature", domain.ErrValidation)
	}
	if amount == 0 || amount > creditGrantMax || amount < -creditGrantMax {
		return 0, fmt.Errorf("%w: amount must be non-zero and at most %d either way", domain.ErrValidation, creditGrantMax)
	}
	note = strings.TrimSpace(note)
	if utf8.RuneCountInString(note) > creditNoteMax {
		return 0, fmt.Errorf("%w: note must be at most %d characters", domain.ErrValidation, creditNoteMax)
	}
	return s.credits.AddCredits(ctx, userID, feature, amount, domain.CreditAdmin, nil, &adminID, note)
}

// notify sends a push to the users `to` returns, in the background: a slow push service must not
// hold up the request, and the request may already be over (its cancellation is ignored). Errors
// are logged and dropped; with push switched off nothing happens.
func (s *PurchaseService) notify(ctx context.Context, to func(context.Context) ([]uuid.UUID, error), title, body string) {
	if s.push == nil || !s.push.Enabled() {
		return
	}
	s.wg.Add(1)
	go func() {
		defer s.wg.Done()
		ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), purchaseNotifyTimeout)
		defer cancel()
		ids, err := to(ctx)
		if err != nil {
			slog.ErrorContext(ctx, "purchase: finding who to notify failed", "err", err)
			return
		}
		if len(ids) == 0 {
			return
		}
		if _, err := s.push.SendTo(ctx, PushTarget{UserIDs: ids}, title, body); err != nil && !errors.Is(err, domain.ErrPushDisabled) {
			slog.ErrorContext(ctx, "purchase: push failed", "title", title, "err", err)
		}
	}()
}

// Wait blocks until the notifications started so far are done (tests; graceful shutdown).
func (s *PurchaseService) Wait() { s.wg.Wait() }

// groupThousands writes 25000 as "25 000".
func groupThousands(n int) string {
	digits := strconv.Itoa(n)
	sign := ""
	if strings.HasPrefix(digits, "-") {
		sign, digits = "-", digits[1:]
	}
	var b strings.Builder
	for i, d := range digits {
		if i > 0 && (len(digits)-i)%3 == 0 {
			b.WriteByte(' ')
		}
		b.WriteRune(d)
	}
	return sign + b.String()
}
