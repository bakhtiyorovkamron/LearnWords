package postgres

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"learnwords/internal/domain"
)

// The chat tables (chat_threads, chat_messages, chat_images) are shared by the support threads and
// the purchase threads; these helpers work inside the caller's transaction or on the pool.

type chatDB interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
}

const chatMessageCols = `m.id, m.thread_id, m.author_role, m.author_user_id, m.body, m.image_key, m.hidden,
	m.hidden_reason, m.event, m.created_at`

func scanChatMessage(row pgx.Row, extra ...any) (domain.ChatMessage, error) {
	var m domain.ChatMessage
	dest := append([]any{&m.ID, &m.ThreadID, &m.AuthorRole, &m.AuthorUserID, &m.Body, &m.ImageKey, &m.Hidden,
		&m.HiddenReason, &m.Event, &m.CreatedAt}, extra...)
	return m, row.Scan(dest...)
}

// chatUnread: the user's messages in thread `t` after the newest one an admin has read.
const chatUnread = `(SELECT count(*) FROM chat_messages um
	WHERE um.thread_id = t.id AND um.author_role = 'user' AND um.id > COALESCE(t.admin_read_message_id, 0))`

// addChatMessage stores a message (and its photo) in a thread and moves the thread's
// last_message_at. An admin's message also marks the thread read up to itself.
func addChatMessage(ctx context.Context, tx pgx.Tx, threadID int64, m domain.ChatMessage, img *domain.ChatImage) (domain.ChatMessage, error) {
	if img != nil {
		if _, err := tx.Exec(ctx, `INSERT INTO chat_images (key, thread_id, content_type, data) VALUES ($1, $2, $3, $4)`,
			img.Key, threadID, img.ContentType, img.Data); err != nil {
			return domain.ChatMessage{}, err
		}
	}
	saved, err := scanChatMessage(tx.QueryRow(ctx, `
		INSERT INTO chat_messages AS m (thread_id, author_role, author_user_id, body, image_key, hidden, hidden_reason, event)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		RETURNING `+chatMessageCols,
		threadID, m.AuthorRole, m.AuthorUserID, m.Body, m.ImageKey, m.Hidden, m.HiddenReason, m.Event))
	if err != nil {
		return domain.ChatMessage{}, err
	}
	if _, err := tx.Exec(ctx, `UPDATE chat_threads SET last_message_at = $2 WHERE id = $1`, threadID, saved.CreatedAt); err != nil {
		return domain.ChatMessage{}, err
	}
	if saved.AuthorRole == domain.ChatAuthorAdmin {
		if err := markChatRead(ctx, tx, threadID, saved.ID); err != nil {
			return domain.ChatMessage{}, err
		}
	}
	return saved, nil
}

// chatMessages: up to limit messages of a thread after `after`, oldest first, that viewerRole may
// see (the admins every message; the user's side also its own hidden ones, not the admins').
func chatMessages(ctx context.Context, db chatDB, threadID, after int64, limit int, viewerRole string) ([]domain.ChatMessage, error) {
	rows, err := db.Query(ctx, `
		SELECT `+chatMessageCols+` FROM chat_messages m
		WHERE m.thread_id = $1 AND m.id > $2 AND (NOT m.hidden OR $4 = 'admin' OR m.author_role = $4)
		ORDER BY m.id LIMIT $3`, threadID, after, limit, viewerRole)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (domain.ChatMessage, error) { return scanChatMessage(row) })
}

// markChatRead: the admins have read the thread up to message upTo (it never moves back).
func markChatRead(ctx context.Context, db chatDB, threadID, upTo int64) error {
	_, err := db.Exec(ctx, `UPDATE chat_threads
		SET admin_read_message_id = GREATEST(COALESCE(admin_read_message_id, 0), $2) WHERE id = $1`, threadID, upTo)
	return err
}

// chatMessageImage: a message of the thread and its photo (ErrNotFound when either is missing).
func chatMessageImage(ctx context.Context, db chatDB, threadID, messageID int64) (domain.ChatMessage, domain.ChatImage, error) {
	var img domain.ChatImage
	m, err := scanChatMessage(db.QueryRow(ctx, `
		SELECT `+chatMessageCols+`, i.key, i.content_type, i.data
		FROM chat_messages m JOIN chat_images i ON i.key = m.image_key
		WHERE m.id = $1 AND m.thread_id = $2`, messageID, threadID), &img.Key, &img.ContentType, &img.Data)
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.ChatMessage{}, domain.ChatImage{}, domain.ErrNotFound
	}
	return m, img, err
}

// ensurePurchaseThread returns the request's thread, creating it on its first message.
func ensurePurchaseThread(ctx context.Context, tx pgx.Tx, requestID, userID uuid.UUID) (int64, error) {
	if _, err := tx.Exec(ctx, `INSERT INTO chat_threads (kind, user_id, purchase_request_id) VALUES ('purchase', $2, $1)
		ON CONFLICT (purchase_request_id) WHERE kind = 'purchase' DO NOTHING`, requestID, userID); err != nil {
		return 0, err
	}
	var id int64
	err := tx.QueryRow(ctx, `SELECT id FROM chat_threads WHERE kind = 'purchase' AND purchase_request_id = $1`, requestID).Scan(&id)
	return id, err
}

// SupportRepository stores the users' support threads (one per user, created on first use).
type SupportRepository struct{ pool *pgxpool.Pool }

func NewSupportRepository(pool *pgxpool.Pool) *SupportRepository {
	return &SupportRepository{pool: pool}
}

const chatThreadCols = `t.id, t.kind, t.user_id, t.purchase_request_id, t.last_message_at, t.created_at`

func scanChatThread(row pgx.Row, extra ...any) (domain.ChatThread, error) {
	var t domain.ChatThread
	dest := append([]any{&t.ID, &t.Kind, &t.UserID, &t.PurchaseRequestID, &t.LastMessageAt, &t.CreatedAt}, extra...)
	return t, row.Scan(dest...)
}

// EnsureThread returns the user's support thread, creating it the first time (two first calls at
// once still make one: the unique index decides).
func (r *SupportRepository) EnsureThread(ctx context.Context, userID uuid.UUID) (domain.ChatThread, error) {
	get := func() (domain.ChatThread, error) {
		return scanChatThread(r.pool.QueryRow(ctx, `SELECT `+chatThreadCols+` FROM chat_threads t
			WHERE t.kind = 'support' AND t.user_id = $1`, userID))
	}
	t, err := get()
	if !errors.Is(err, pgx.ErrNoRows) {
		return t, err
	}
	if _, err := r.pool.Exec(ctx, `INSERT INTO chat_threads (kind, user_id) VALUES ('support', $1)
		ON CONFLICT (user_id) WHERE kind = 'support' DO NOTHING`, userID); err != nil {
		return domain.ChatThread{}, notFoundOnFK(err)
	}
	return get()
}

// Thread returns a support thread with its user's email and unread count (ErrNotFound when there
// is no support thread with this id).
func (r *SupportRepository) Thread(ctx context.Context, id int64) (domain.ChatThread, error) {
	var (
		email  string
		unread int
	)
	t, err := scanChatThread(r.pool.QueryRow(ctx, `SELECT `+chatThreadCols+`, u.email, `+chatUnread+`
		FROM chat_threads t JOIN users u ON u.id = t.user_id WHERE t.id = $1 AND t.kind = 'support'`, id), &email, &unread)
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.ChatThread{}, domain.ErrNotFound
	}
	t.UserEmail, t.Unread = email, unread
	return t, err
}

// Threads lists the support threads that have messages, the newest conversation first, with the
// user's email, the unread count and the last message; unreadOnly keeps those with unread ones.
func (r *SupportRepository) Threads(ctx context.Context, unreadOnly bool, limit int) ([]domain.ChatThread, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT * FROM (
			SELECT `+chatThreadCols+`, u.email, `+chatUnread+` AS unread,
			       lm.id AS lm_id, lm.thread_id AS lm_thread_id, lm.author_role AS lm_author_role,
			       lm.author_user_id AS lm_author_user_id, lm.body AS lm_body, lm.image_key AS lm_image_key,
			       lm.hidden AS lm_hidden, lm.hidden_reason AS lm_hidden_reason, lm.event AS lm_event,
			       lm.created_at AS lm_created_at
			FROM chat_threads t
			JOIN users u ON u.id = t.user_id
			JOIN LATERAL (SELECT * FROM chat_messages m WHERE m.thread_id = t.id ORDER BY m.id DESC LIMIT 1) lm ON true
			WHERE t.kind = 'support'
		) s
		WHERE NOT $1 OR s.unread > 0
		ORDER BY s.last_message_at DESC NULLS LAST, s.id DESC
		LIMIT $2`, unreadOnly, limit)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (domain.ChatThread, error) {
		var (
			email  string
			unread int
			last   domain.ChatMessage
		)
		t, err := scanChatThread(row, &email, &unread, &last.ID, &last.ThreadID, &last.AuthorRole, &last.AuthorUserID,
			&last.Body, &last.ImageKey, &last.Hidden, &last.HiddenReason, &last.Event, &last.CreatedAt)
		t.UserEmail, t.Unread, t.LastMessage = email, unread, &last
		return t, err
	})
}

// AddMessage stores a message (and its photo) in a support thread.
func (r *SupportRepository) AddMessage(ctx context.Context, threadID int64, m domain.ChatMessage, img *domain.ChatImage) (domain.ChatMessage, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return domain.ChatMessage{}, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck // a no-op after Commit
	saved, err := addChatMessage(ctx, tx, threadID, m, img)
	if err != nil {
		return domain.ChatMessage{}, notFoundOnFK(err)
	}
	return saved, tx.Commit(ctx)
}

// Messages: up to limit after `after`, oldest first, those viewerRole may see.
func (r *SupportRepository) Messages(ctx context.Context, threadID, after int64, limit int, viewerRole string) ([]domain.ChatMessage, error) {
	return chatMessages(ctx, r.pool, threadID, after, limit, viewerRole)
}

// MarkRead marks the thread read for the admins up to upTo (0 = its newest message).
func (r *SupportRepository) MarkRead(ctx context.Context, threadID, upTo int64) error {
	if upTo == 0 {
		if err := r.pool.QueryRow(ctx, `SELECT COALESCE(max(id), 0) FROM chat_messages WHERE thread_id = $1`, threadID).Scan(&upTo); err != nil {
			return err
		}
	}
	return markChatRead(ctx, r.pool, threadID, upTo)
}

// MessageImage: a message of the thread and its photo.
func (r *SupportRepository) MessageImage(ctx context.Context, threadID, messageID int64) (domain.ChatMessage, domain.ChatImage, error) {
	return chatMessageImage(ctx, r.pool, threadID, messageID)
}
