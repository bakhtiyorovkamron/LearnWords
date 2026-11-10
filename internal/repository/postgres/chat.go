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

// chatUserUnread: the admins' and system messages in thread `t` after the newest one the user has
// read (a message hidden from the user is not counted: they cannot see it).
const chatUserUnread = `(SELECT count(*) FROM chat_messages am
	WHERE am.thread_id = t.id AND am.author_role IN ('admin', 'system') AND NOT am.hidden
	AND am.id > COALESCE(t.user_read_message_id, 0))`

// addChatMessage stores a message (and its photo) in a thread and moves the thread's
// last_message_at. A message also marks the thread read for its own side up to itself.
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
	switch saved.AuthorRole {
	case domain.ChatAuthorAdmin:
		if err := markChatRead(ctx, tx, threadID, saved.ID); err != nil {
			return domain.ChatMessage{}, err
		}
	case domain.ChatAuthorUser:
		if _, err := markUserChatRead(ctx, tx, threadID, nil, saved.ID); err != nil {
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

// markUserChatRead: the user has read the thread up to message upTo (never backwards, never past the
// thread's newest message). userID != nil limits it to that user's own thread; ok = false when there
// is no such thread.
func markUserChatRead(ctx context.Context, db chatDB, threadID int64, userID *uuid.UUID, upTo int64) (bool, error) {
	tag, err := db.Exec(ctx, `UPDATE chat_threads SET user_read_message_id = GREATEST(COALESCE(user_read_message_id, 0),
			LEAST($2::bigint, COALESCE((SELECT max(id) FROM chat_messages WHERE thread_id = $1), 0)))
		WHERE id = $1 AND ($3::uuid IS NULL OR user_id = $3)`, threadID, upTo, userID)
	return tag.RowsAffected() > 0, err
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

const chatThreadCols = `t.id, t.kind, t.user_id, t.purchase_request_id, t.last_message_at, t.created_at,
	COALESCE(t.user_read_message_id, 0), COALESCE(t.admin_read_message_id, 0)`

func scanChatThread(row pgx.Row, extra ...any) (domain.ChatThread, error) {
	var t domain.ChatThread
	dest := append([]any{&t.ID, &t.Kind, &t.UserID, &t.PurchaseRequestID, &t.LastMessageAt, &t.CreatedAt,
		&t.ReadMarkers.User, &t.ReadMarkers.Admin}, extra...)
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

// MarkUserRead: the user has read their thread up to upTo (ErrNotFound when it is not theirs).
func (r *SupportRepository) MarkUserRead(ctx context.Context, userID uuid.UUID, threadID, upTo int64) error {
	ok, err := markUserChatRead(ctx, r.pool, threadID, &userID, upTo)
	if err == nil && !ok {
		return domain.ErrNotFound
	}
	return err
}

// MessageImage: a message of the thread and its photo.
func (r *SupportRepository) MessageImage(ctx context.Context, threadID, messageID int64) (domain.ChatMessage, domain.ChatImage, error) {
	return chatMessageImage(ctx, r.pool, threadID, messageID)
}

// ChatUnreadRepository counts unread chat messages for the badges: one query per side.
type ChatUnreadRepository struct{ pool *pgxpool.Pool }

func NewChatUnreadRepository(pool *pgxpool.Pool) *ChatUnreadRepository {
	return &ChatUnreadRepository{pool: pool}
}

// ForUser: the user's unread support messages and, per purchase request that has a thread with
// unread messages, the unread ones (the most recently active request first).
func (r *ChatUnreadRepository) ForUser(ctx context.Context, userID uuid.UUID) (domain.UserChatUnread, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT t.kind, t.purchase_request_id, COALESCE(p.code, ''), count(*)
		FROM chat_threads t
		JOIN chat_messages m ON m.thread_id = t.id AND m.author_role IN ('admin', 'system') AND NOT m.hidden
		     AND m.id > COALESCE(t.user_read_message_id, 0)
		LEFT JOIN purchase_requests p ON p.id = t.purchase_request_id
		WHERE t.user_id = $1
		GROUP BY t.id, p.code
		ORDER BY max(m.id) DESC`, userID)
	if err != nil {
		return domain.UserChatUnread{}, err
	}
	defer rows.Close()
	out := domain.UserChatUnread{Purchases: []domain.PurchaseChatUnread{}}
	for rows.Next() {
		var (
			kind string
			req  *uuid.UUID
			code string
			n    int
		)
		if err := rows.Scan(&kind, &req, &code, &n); err != nil {
			return domain.UserChatUnread{}, err
		}
		if kind == domain.ChatKindSupport || req == nil {
			out.Support += n
			continue
		}
		out.Purchases = append(out.Purchases, domain.PurchaseChatUnread{ID: *req, Code: code, Unread: n})
	}
	return out, rows.Err()
}

// ForAdmins: the users' messages no admin has read, in support threads and in purchase threads.
func (r *ChatUnreadRepository) ForAdmins(ctx context.Context) (domain.AdminChatUnread, error) {
	var out domain.AdminChatUnread
	err := r.pool.QueryRow(ctx, `
		SELECT count(*) FILTER (WHERE t.kind = 'support'), count(*) FILTER (WHERE t.kind = 'purchase')
		FROM chat_messages m JOIN chat_threads t ON t.id = m.thread_id
		WHERE m.author_role = 'user' AND m.id > COALESCE(t.admin_read_message_id, 0)`).Scan(&out.Support, &out.Purchases)
	return out, err
}
