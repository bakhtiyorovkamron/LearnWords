package postgres

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"learnwords/internal/domain"
)

const messageCols = `m.id, m.request_id, m.author_role, m.author_user_id, m.body, m.image_key, m.hidden,
	m.hidden_reason, m.event, m.created_at`

func scanMessage(row pgx.Row, extra ...any) (domain.PurchaseMessage, error) {
	var m domain.PurchaseMessage
	dest := append([]any{&m.ID, &m.RequestID, &m.AuthorRole, &m.AuthorUserID, &m.Body, &m.ImageKey, &m.Hidden,
		&m.HiddenReason, &m.Event, &m.CreatedAt}, extra...)
	return m, row.Scan(dest...)
}

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

// unreadCol: the buyer's messages after the newest one an admin has read.
const unreadCol = `(SELECT count(*) FROM purchase_messages um
	WHERE um.request_id = p.id AND um.author_role = 'buyer' AND um.id > COALESCE(p.admin_read_message_id, 0))`

// AddMessage stores a buyer's or an admin's message (and its photo) unless the request is cancelled
// or rejected (ErrChatClosed; a missing one is ErrPurchaseNotFound). The request row is locked
// FOR SHARE, so a cancel either happens before (the message is refused) or waits for it. An admin's
// message also marks the chat read up to itself.
func (r *PurchaseRepository) AddMessage(ctx context.Context, m domain.PurchaseMessage, img *domain.ChatImage) (domain.PurchaseMessage, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return domain.PurchaseMessage{}, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck // a no-op after Commit
	var status string
	err = tx.QueryRow(ctx, `SELECT status FROM purchase_requests WHERE id = $1 FOR SHARE`, m.RequestID).Scan(&status)
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.PurchaseMessage{}, domain.ErrPurchaseNotFound
	}
	if err != nil {
		return domain.PurchaseMessage{}, err
	}
	if !domain.ChatOpen(status) {
		return domain.PurchaseMessage{}, domain.ErrChatClosed
	}
	if img != nil {
		if _, err := tx.Exec(ctx, `INSERT INTO purchase_message_images (key, request_id, content_type, data) VALUES ($1, $2, $3, $4)`,
			img.Key, m.RequestID, img.ContentType, img.Data); err != nil {
			return domain.PurchaseMessage{}, err
		}
	}
	saved, err := insertMessage(ctx, tx, m)
	if err != nil {
		return domain.PurchaseMessage{}, err
	}
	if saved.AuthorRole == domain.ChatAuthorAdmin {
		if err := markAdminRead(ctx, tx, saved.RequestID, saved.ID); err != nil {
			return domain.PurchaseMessage{}, err
		}
	}
	return saved, tx.Commit(ctx)
}

// insertMessage adds a message and moves the request's last_message_at, in the caller's transaction.
func insertMessage(ctx context.Context, tx pgx.Tx, m domain.PurchaseMessage) (domain.PurchaseMessage, error) {
	saved, err := scanMessage(tx.QueryRow(ctx, `
		INSERT INTO purchase_messages AS m (request_id, author_role, author_user_id, body, image_key, hidden, hidden_reason, event)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		RETURNING `+messageCols,
		m.RequestID, m.AuthorRole, m.AuthorUserID, m.Body, m.ImageKey, m.Hidden, m.HiddenReason, m.Event))
	if err != nil {
		return domain.PurchaseMessage{}, err
	}
	if _, err := tx.Exec(ctx, `UPDATE purchase_requests SET last_message_at = $2 WHERE id = $1`, saved.RequestID, saved.CreatedAt); err != nil {
		return domain.PurchaseMessage{}, err
	}
	return saved, nil
}

// systemMessage writes the line a decision leaves in the chat ("paid" or "cancelled").
func systemMessage(ctx context.Context, tx pgx.Tx, p domain.PurchaseRequest) error {
	event, body := domain.ChatEventCancelled, domain.ChatCancelledText
	if p.Status == domain.PurchasePaid {
		event, body = domain.ChatEventPaid, domain.ChatPaidText(p.Amount)
	}
	_, err := insertMessage(ctx, tx, domain.PurchaseMessage{RequestID: p.ID, AuthorRole: domain.ChatAuthorSystem, Body: &body, Event: &event})
	return err
}

// Messages returns up to limit messages after `after` (oldest first) that viewerRole may see: the
// admins see every message, the buyer's side also its own hidden ones but not the admins'.
func (r *PurchaseRepository) Messages(ctx context.Context, requestID uuid.UUID, after int64, limit int, viewerRole string) ([]domain.PurchaseMessage, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT `+messageCols+` FROM purchase_messages m
		WHERE m.request_id = $1 AND m.id > $2 AND (NOT m.hidden OR $4 = 'admin' OR m.author_role = $4)
		ORDER BY m.id LIMIT $3`, requestID, after, limit, viewerRole)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (domain.PurchaseMessage, error) { return scanMessage(row) })
}

// MarkAdminRead: the admins have read the chat up to message upTo (it never moves back).
func (r *PurchaseRepository) MarkAdminRead(ctx context.Context, requestID uuid.UUID, upTo int64) error {
	_, err := r.pool.Exec(ctx, markAdminReadSQL, requestID, upTo)
	return err
}

const markAdminReadSQL = `UPDATE purchase_requests
	SET admin_read_message_id = GREATEST(COALESCE(admin_read_message_id, 0), $2) WHERE id = $1`

func markAdminRead(ctx context.Context, tx pgx.Tx, requestID uuid.UUID, upTo int64) error {
	_, err := tx.Exec(ctx, markAdminReadSQL, requestID, upTo)
	return err
}

// MessageImage returns a message of the request and its photo (ErrNotFound when either is missing).
func (r *PurchaseRepository) MessageImage(ctx context.Context, requestID uuid.UUID, messageID int64) (domain.PurchaseMessage, domain.ChatImage, error) {
	var img domain.ChatImage
	m, err := scanMessage(r.pool.QueryRow(ctx, `
		SELECT `+messageCols+`, i.key, i.content_type, i.data
		FROM purchase_messages m JOIN purchase_message_images i ON i.key = m.image_key
		WHERE m.id = $1 AND m.request_id = $2`, messageID, requestID), &img.Key, &img.ContentType, &img.Data)
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.PurchaseMessage{}, domain.ChatImage{}, domain.ErrNotFound
	}
	return m, img, err
}
