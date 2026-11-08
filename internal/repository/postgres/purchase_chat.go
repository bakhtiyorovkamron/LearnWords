package postgres

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"learnwords/internal/domain"
)

// A purchase request's chat lives in the shared chat tables: one 'purchase' thread per request,
// created with its first message (or system line).

// purchaseThreadOf: the request's thread, as a join condition on alias t.
const purchaseThreadOf = `t.kind = 'purchase' AND t.purchase_request_id = p.id`

// unreadCol: the buyer's messages after the newest one an admin has read (0 without a thread).
const unreadCol = `COALESCE((SELECT ` + chatUnread + ` FROM chat_threads t WHERE ` + purchaseThreadOf + `), 0)`

// Get returns one request with the user's email and the admins' unread count.
func (r *PurchaseRepository) Get(ctx context.Context, id uuid.UUID) (domain.PurchaseRequest, error) {
	var (
		email  string
		unread int
	)
	p, err := scanPurchase(r.pool.QueryRow(ctx, `
		SELECT `+purchaseCols+`, u.email, `+unreadCol+`
		FROM purchase_requests p JOIN users u ON u.id = p.user_id WHERE p.id = $1`, id), &email, &unread)
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.PurchaseRequest{}, domain.ErrPurchaseNotFound
	}
	p.UserEmail, p.Unread = email, unread
	return p, err
}

// AddMessage stores a buyer's or an admin's message (and its photo) unless the request is cancelled
// or rejected (ErrChatClosed; a missing one is ErrPurchaseNotFound). The request row is locked
// FOR SHARE, so a cancel either happens before (the message is refused) or waits for it.
func (r *PurchaseRepository) AddMessage(ctx context.Context, requestID uuid.UUID, m domain.ChatMessage, img *domain.ChatImage) (domain.ChatMessage, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return domain.ChatMessage{}, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck // a no-op after Commit
	var (
		status string
		userID uuid.UUID
	)
	err = tx.QueryRow(ctx, `SELECT status, user_id FROM purchase_requests WHERE id = $1 FOR SHARE`, requestID).Scan(&status, &userID)
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.ChatMessage{}, domain.ErrPurchaseNotFound
	}
	if err != nil {
		return domain.ChatMessage{}, err
	}
	if !domain.ChatOpen(status) {
		return domain.ChatMessage{}, domain.ErrChatClosed
	}
	thread, err := ensurePurchaseThread(ctx, tx, requestID, userID)
	if err != nil {
		return domain.ChatMessage{}, err
	}
	saved, err := addChatMessage(ctx, tx, thread, m, img)
	if err != nil {
		return domain.ChatMessage{}, err
	}
	return saved, tx.Commit(ctx)
}

// systemMessage writes the line a decision leaves in the request's chat ("paid" or "cancelled").
func systemMessage(ctx context.Context, tx pgx.Tx, p domain.PurchaseRequest) error {
	event, body := domain.ChatEventCancelled, domain.ChatCancelledText
	if p.Status == domain.PurchasePaid {
		event, body = domain.ChatEventPaid, domain.ChatPaidText(p.Amount)
	}
	thread, err := ensurePurchaseThread(ctx, tx, p.ID, p.UserID)
	if err != nil {
		return err
	}
	_, err = addChatMessage(ctx, tx, thread, domain.ChatMessage{AuthorRole: domain.ChatAuthorSystem, Body: &body, Event: &event}, nil)
	return err
}

// purchaseThread: the request's thread id; ok = false while it has no messages yet.
func (r *PurchaseRepository) purchaseThread(ctx context.Context, requestID uuid.UUID) (int64, bool, error) {
	var id int64
	err := r.pool.QueryRow(ctx, `SELECT id FROM chat_threads WHERE kind = 'purchase' AND purchase_request_id = $1`, requestID).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, false, nil
	}
	return id, err == nil, err
}

// Messages returns up to limit messages after `after` (oldest first) that viewerRole may see.
func (r *PurchaseRepository) Messages(ctx context.Context, requestID uuid.UUID, after int64, limit int, viewerRole string) ([]domain.ChatMessage, error) {
	thread, ok, err := r.purchaseThread(ctx, requestID)
	if err != nil || !ok {
		return nil, err
	}
	return chatMessages(ctx, r.pool, thread, after, limit, viewerRole)
}

// MarkAdminRead: the admins have read the request's chat up to message upTo (it never moves back).
func (r *PurchaseRepository) MarkAdminRead(ctx context.Context, requestID uuid.UUID, upTo int64) error {
	thread, ok, err := r.purchaseThread(ctx, requestID)
	if err != nil || !ok {
		return err
	}
	return markChatRead(ctx, r.pool, thread, upTo)
}

// MessageImage returns a message of the request and its photo (ErrNotFound when either is missing).
func (r *PurchaseRepository) MessageImage(ctx context.Context, requestID uuid.UUID, messageID int64) (domain.ChatMessage, domain.ChatImage, error) {
	thread, ok, err := r.purchaseThread(ctx, requestID)
	if err != nil {
		return domain.ChatMessage{}, domain.ChatImage{}, err
	}
	if !ok {
		return domain.ChatMessage{}, domain.ChatImage{}, domain.ErrNotFound
	}
	return chatMessageImage(ctx, r.pool, thread, messageID)
}
