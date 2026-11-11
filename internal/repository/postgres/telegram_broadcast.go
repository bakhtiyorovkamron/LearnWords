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

// telegramReachable: who can get a broadcast.
const telegramReachable = `telegram_chat_id IS NOT NULL AND telegram_notifications AND telegram_blocked_at IS NULL AND NOT is_banned`

// advisory lock key: serialises creating "all" broadcasts, so two of them cannot both be queued.
const broadcastAllLock = 5300001

const broadcastCols = `id, admin_id, kind, target, text_ru, text_uz, text_en, button_text, button_url, status,
	total, sent, failed, blocked, created_at, finished_at`

// TelegramBroadcastRepository stores broadcasts and their recipients.
type TelegramBroadcastRepository struct{ pool *pgxpool.Pool }

func NewTelegramBroadcastRepository(pool *pgxpool.Pool) *TelegramBroadcastRepository {
	return &TelegramBroadcastRepository{pool: pool}
}

func scanBroadcast(row pgx.Row) (domain.TelegramBroadcast, error) {
	var (
		b       domain.TelegramBroadcast
		btnText *string
		btnURL  *string
	)
	err := row.Scan(&b.ID, &b.AdminID, &b.Kind, &b.Target, &b.Text.RU, &b.Text.UZ, &b.Text.EN, &btnText, &btnURL,
		&b.Status, &b.Total, &b.Sent, &b.Failed, &b.Blocked, &b.CreatedAt, &b.FinishedAt)
	if btnText != nil && btnURL != nil {
		b.Button = &domain.TelegramButton{Text: *btnText, URL: *btnURL}
	}
	return b, err
}

// Audience counts the users that linked Telegram and who of them can get a broadcast.
func (r *TelegramBroadcastRepository) Audience(ctx context.Context) (domain.TelegramAudience, error) {
	var a domain.TelegramAudience
	err := r.pool.QueryRow(ctx, `SELECT
		count(*) FILTER (WHERE telegram_chat_id IS NOT NULL),
		count(*) FILTER (WHERE `+telegramReachable+`),
		count(*) FILTER (WHERE telegram_chat_id IS NOT NULL AND NOT telegram_notifications),
		count(*) FILTER (WHERE telegram_chat_id IS NOT NULL AND telegram_blocked_at IS NOT NULL)
		FROM users`).Scan(&a.Linked, &a.Reachable, &a.OptedOut, &a.Blocked)
	return a, err
}

// CreateBroadcast stores the broadcast and snapshots its recipients in one transaction: "all" = every
// reachable user, "users" = those of p.UserIDs that are reachable (skipped = the others), "me" = the
// admin (ErrTelegramNotLinked without a chat; opting out or blocking does not matter for a test).
// A second "all" while one is queued or running is ErrBroadcastRunning.
func (r *TelegramBroadcastRepository) CreateBroadcast(ctx context.Context, p domain.BroadcastParams) (domain.TelegramBroadcast, int, error) {
	var (
		out     domain.TelegramBroadcast
		skipped int
	)
	err := pgx.BeginFunc(ctx, r.pool, func(tx pgx.Tx) error {
		switch p.Target {
		case domain.BroadcastTargetAll:
			if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock($1)`, broadcastAllLock); err != nil {
				return err
			}
			var busy bool
			if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM telegram_broadcasts WHERE target = 'all' AND status IN ('queued', 'running'))`).Scan(&busy); err != nil {
				return err
			}
			if busy {
				return domain.ErrBroadcastRunning
			}
		case domain.BroadcastTargetMe:
			var linked bool
			err := tx.QueryRow(ctx, `SELECT telegram_chat_id IS NOT NULL FROM users WHERE id = $1`, p.AdminID).Scan(&linked)
			if errors.Is(err, pgx.ErrNoRows) || (err == nil && !linked) {
				return domain.ErrTelegramNotLinked
			}
			if err != nil {
				return err
			}
		}
		var btnText, btnURL *string
		if p.Button != nil {
			btnText, btnURL = &p.Button.Text, &p.Button.URL
		}
		b, err := scanBroadcast(tx.QueryRow(ctx, `INSERT INTO telegram_broadcasts (admin_id, target, text_ru, text_uz, text_en, button_text, button_url, status)
			VALUES ($1, $2, $3, $4, $5, $6, $7, 'queued') RETURNING `+broadcastCols,
			p.AdminID, p.Target, p.Text.RU, p.Text.UZ, p.Text.EN, btnText, btnURL))
		if err != nil {
			return err
		}
		var tag pgconn.CommandTag
		switch p.Target {
		case domain.BroadcastTargetAll:
			tag, err = tx.Exec(ctx, `INSERT INTO telegram_broadcast_recipients (broadcast_id, user_id)
				SELECT $1, id FROM users WHERE `+telegramReachable, b.ID)
		case domain.BroadcastTargetUsers:
			tag, err = tx.Exec(ctx, `INSERT INTO telegram_broadcast_recipients (broadcast_id, user_id)
				SELECT $1, id FROM users WHERE id = ANY($2) AND `+telegramReachable, b.ID, p.UserIDs)
		default:
			tag, err = tx.Exec(ctx, `INSERT INTO telegram_broadcast_recipients (broadcast_id, user_id) VALUES ($1, $2)`, b.ID, p.AdminID)
		}
		if err != nil {
			return err
		}
		b.Total = int(tag.RowsAffected())
		if _, err := tx.Exec(ctx, `UPDATE telegram_broadcasts SET total = $2 WHERE id = $1`, b.ID, b.Total); err != nil {
			return err
		}
		if p.Target == domain.BroadcastTargetUsers {
			skipped = len(p.UserIDs) - b.Total
		}
		out = b
		return nil
	})
	return out, skipped, err
}

// ClaimNext takes the oldest queued broadcast and marks it running (nil = none).
func (r *TelegramBroadcastRepository) ClaimNext(ctx context.Context) (*domain.TelegramBroadcast, error) {
	b, err := scanBroadcast(r.pool.QueryRow(ctx, `UPDATE telegram_broadcasts SET status = 'running' WHERE id = (
			SELECT id FROM telegram_broadcasts WHERE status = 'queued' ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED)
		RETURNING `+broadcastCols))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &b, nil
}

// PendingRecipients: up to limit recipients still 'pending', with their chat and language. For a
// "me" broadcast any linked chat counts as reachable; otherwise the reachable rule is checked again.
func (r *TelegramBroadcastRepository) PendingRecipients(ctx context.Context, id int64, target string, limit int) ([]domain.BroadcastRecipient, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT r.user_id, u.telegram_chat_id, COALESCE(u.telegram_lang, 'ru'),
		       COALESCE(u.telegram_chat_id IS NOT NULL AND ($3 OR (u.telegram_notifications AND u.telegram_blocked_at IS NULL AND NOT u.is_banned)), false),
		       COALESCE(u.telegram_blocked_at IS NOT NULL, false)
		FROM telegram_broadcast_recipients r LEFT JOIN users u ON u.id = r.user_id
		WHERE r.broadcast_id = $1 AND r.status = 'pending'
		ORDER BY r.user_id LIMIT $2`, id, limit, target == domain.BroadcastTargetMe)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (domain.BroadcastRecipient, error) {
		var x domain.BroadcastRecipient
		err := row.Scan(&x.UserID, &x.ChatID, &x.Lang, &x.Reachable, &x.Blocked)
		return x, err
	})
}

// SetRecipient records what happened to one recipient.
func (r *TelegramBroadcastRepository) SetRecipient(ctx context.Context, id int64, userID uuid.UUID, status string) error {
	_, err := r.pool.Exec(ctx, `UPDATE telegram_broadcast_recipients SET status = $3 WHERE broadcast_id = $1 AND user_id = $2`, id, userID, status)
	return err
}

// MarkUserBlocked: Telegram refused a message to the user with 403.
func (r *TelegramBroadcastRepository) MarkUserBlocked(ctx context.Context, userID uuid.UUID) error {
	_, err := r.pool.Exec(ctx, `UPDATE users SET telegram_blocked_at = now() WHERE id = $1 AND telegram_chat_id IS NOT NULL`, userID)
	return err
}

// RefreshCounters recounts sent / failed / blocked from the recipients (so they are always right).
func (r *TelegramBroadcastRepository) RefreshCounters(ctx context.Context, id int64) error {
	_, err := r.pool.Exec(ctx, `UPDATE telegram_broadcasts b SET sent = c.s, failed = c.f, blocked = c.b
		FROM (SELECT count(*) FILTER (WHERE status = 'sent') AS s, count(*) FILTER (WHERE status = 'failed') AS f,
		             count(*) FILTER (WHERE status = 'blocked') AS b
		      FROM telegram_broadcast_recipients WHERE broadcast_id = $1) c
		WHERE b.id = $1`, id)
	return err
}

// Finish sets the final status ('done' or 'interrupted') and the finish time.
func (r *TelegramBroadcastRepository) Finish(ctx context.Context, id int64, status string) error {
	_, err := r.pool.Exec(ctx, `UPDATE telegram_broadcasts SET status = $2, finished_at = now() WHERE id = $1`, id, status)
	return err
}

// InterruptUnfinished marks every queued or running broadcast 'interrupted' (a restart): nothing resumes.
func (r *TelegramBroadcastRepository) InterruptUnfinished(ctx context.Context) error {
	_, err := r.pool.Exec(ctx, `UPDATE telegram_broadcasts SET status = 'interrupted', finished_at = now() WHERE status IN ('queued', 'running')`)
	return err
}

// List returns the newest broadcasts first.
func (r *TelegramBroadcastRepository) List(ctx context.Context, limit int) ([]domain.TelegramBroadcast, error) {
	rows, err := r.pool.Query(ctx, `SELECT `+broadcastCols+` FROM telegram_broadcasts ORDER BY id DESC LIMIT $1`, limit)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (domain.TelegramBroadcast, error) { return scanBroadcast(row) })
}

// Get returns one broadcast (ErrNotFound when missing).
func (r *TelegramBroadcastRepository) Get(ctx context.Context, id int64) (domain.TelegramBroadcast, error) {
	b, err := scanBroadcast(r.pool.QueryRow(ctx, `SELECT `+broadcastCols+` FROM telegram_broadcasts WHERE id = $1`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.TelegramBroadcast{}, domain.ErrNotFound
	}
	return b, err
}
