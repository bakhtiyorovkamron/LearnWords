package postgres

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"learnwords/internal/domain"
	"learnwords/internal/service"
)

var errNobody = errors.New("no recipients")

// TelegramRulesRepository stores the automatic notification rules and finds who a run is for.
type TelegramRulesRepository struct{ pool *pgxpool.Pool }

func NewTelegramRulesRepository(pool *pgxpool.Pool) *TelegramRulesRepository {
	return &TelegramRulesRepository{pool: pool}
}

const ruleCols = `r.key, r.enabled, to_char(r.send_at, 'HH24:MI'), r.text_ru, r.text_uz, r.text_en, r.button_text, r.button_url,
	to_char(r.last_run_on, 'YYYY-MM-DD'),
	(SELECT b.sent FROM telegram_broadcasts b WHERE b.kind = 'auto:' || r.key ORDER BY b.id DESC LIMIT 1)`

func scanRule(row pgx.Row) (domain.TelegramRule, error) {
	var (
		r       domain.TelegramRule
		btnText *string
		btnURL  *string
	)
	err := row.Scan(&r.Key, &r.Enabled, &r.SendAt, &r.Text.RU, &r.Text.UZ, &r.Text.EN, &btnText, &btnURL, &r.LastRunOn, &r.LastSent)
	if btnText != nil && btnURL != nil {
		r.Button = &domain.TelegramButton{Text: *btnText, URL: *btnURL}
	}
	if def, ok := domain.RuleDefOf(r.Key); ok {
		r.Placeholders = def.Placeholders
	}
	return r, err
}

// Rules lists the rules in a fixed order.
func (r *TelegramRulesRepository) Rules(ctx context.Context) ([]domain.TelegramRule, error) {
	rows, err := r.pool.Query(ctx, `SELECT `+ruleCols+` FROM telegram_rules r
		ORDER BY array_position(ARRAY['review_reminder', 'comeback', 'purchase_paid', 'purchase_rejected'], r.key)`)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (domain.TelegramRule, error) { return scanRule(row) })
}

// Rule returns one rule (ErrNotFound when there is none).
func (r *TelegramRulesRepository) Rule(ctx context.Context, key string) (domain.TelegramRule, error) {
	rule, err := scanRule(r.pool.QueryRow(ctx, `SELECT `+ruleCols+` FROM telegram_rules r WHERE r.key = $1`, key))
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.TelegramRule{}, domain.ErrNotFound
	}
	return rule, err
}

// SaveRule stores the editable fields of a (validated) rule.
func (r *TelegramRulesRepository) SaveRule(ctx context.Context, rule domain.TelegramRule) (domain.TelegramRule, error) {
	var btnText, btnURL *string
	if rule.Button != nil {
		btnText, btnURL = &rule.Button.Text, &rule.Button.URL
	}
	tag, err := r.pool.Exec(ctx, `UPDATE telegram_rules SET enabled = $2, send_at = $3::time, text_ru = $4, text_uz = $5, text_en = $6,
		button_text = $7, button_url = $8, updated_at = now() WHERE key = $1`,
		rule.Key, rule.Enabled, rule.SendAt, rule.Text.RU, rule.Text.UZ, rule.Text.EN, btnText, btnURL)
	if err != nil {
		return domain.TelegramRule{}, err
	}
	if tag.RowsAffected() == 0 {
		return domain.TelegramRule{}, domain.ErrNotFound
	}
	return r.Rule(ctx, rule.Key)
}

// ClaimRun takes today's run of an enabled rule: true for exactly one caller per day, however many
// run at once (or after a restart).
func (r *TelegramRulesRepository) ClaimRun(ctx context.Context, key string, today time.Time) (bool, error) {
	var got string
	err := r.pool.QueryRow(ctx, `UPDATE telegram_rules SET last_run_on = $2::date
		WHERE key = $1 AND enabled AND (last_run_on IS NULL OR last_run_on < $2::date) RETURNING key`, key, today).Scan(&got)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	return err == nil, err
}

// ReleaseRun gives today's claim back (the run could not be created), so a later minute can try again.
func (r *TelegramRulesRepository) ReleaseRun(ctx context.Context, key string, today time.Time) error {
	_, err := r.pool.Exec(ctx, `UPDATE telegram_rules SET last_run_on = NULL WHERE key = $1 AND last_run_on = $2::date`, key, today)
	return err
}

// lastActivity is the same "last activity" as AdminRepository.ListUsers: the latest word, review or story.
const ruleAudienceFrom = `
	FROM users u
	JOIN (SELECT w.user_id, count(*) AS n
	      FROM word_cards w LEFT JOIN word_progress p ON p.word_id = w.id
	      WHERE COALESCE(p.is_learned, false) = false AND COALESCE(p.next_review_at, $1::date) <= $1::date AND NOT w.paused
	      GROUP BY w.user_id) due ON due.user_id = u.id
	LEFT JOIN (SELECT user_id, max(created_at) AS last_at FROM word_cards GROUP BY user_id) wc ON wc.user_id = u.id
	LEFT JOIN (SELECT user_id, max(reviewed_at) AS last_at FROM review_logs GROUP BY user_id) rl ON rl.user_id = u.id
	LEFT JOIN (SELECT user_id, max(created_at) AS last_at FROM daily_stories GROUP BY user_id) ds ON ds.user_id = u.id
	WHERE u.telegram_chat_id IS NOT NULL AND u.telegram_notifications AND u.telegram_blocked_at IS NULL AND NOT u.is_banned
	  AND NOT EXISTS (SELECT 1 FROM telegram_broadcast_recipients tr JOIN telegram_broadcasts tb ON tb.id = tr.broadcast_id
	                  WHERE tr.user_id = u.id AND tb.kind IN ('auto:review_reminder', 'auto:comeback')
	                    AND tb.created_at >= $2 AND tr.status IN ('pending', 'sent'))`

// ruleAudienceWhere: the rest of the condition of a daily rule.
func ruleAudienceWhere(key string) (string, error) {
	const last = `GREATEST(wc.last_at, rl.last_at, ds.last_at)`
	switch key {
	case domain.RuleReviewReminder:
		// Active in the last 7 days, not reviewed today (any answer today counts), fewer than 3 unanswered.
		return ` AND u.telegram_reminders_unanswered < ` + fmt.Sprint(domain.RuleMaxUnanswered) +
			` AND ` + last + ` > $3::timestamptz - interval '` + fmt.Sprint(domain.RuleAbsenceDays) + ` days'
			AND NOT EXISTS (SELECT 1 FROM review_logs x WHERE x.user_id = u.id AND x.reviewed_at >= $2)`, nil
	case domain.RuleComeback:
		// Gone for 7 or more days; once per absence (not since they were last active).
		return ` AND ` + last + ` <= $3::timestamptz - interval '` + fmt.Sprint(domain.RuleAbsenceDays) + ` days'
			AND (u.telegram_comeback_sent_at IS NULL OR u.telegram_comeback_sent_at < ` + last + `)`, nil
	}
	return "", fmt.Errorf("rule %q has no audience", key)
}

// CountRuleAudience: how many users a run of the rule would reach at this moment.
func (r *TelegramRulesRepository) CountRuleAudience(ctx context.Context, key string, day service.RuleDay) (int, error) {
	where, err := ruleAudienceWhere(key)
	if err != nil {
		return 0, err
	}
	var n int
	err = r.pool.QueryRow(ctx, `SELECT count(*)`+ruleAudienceFrom+where, day.Today, day.Start, day.Now).Scan(&n)
	return n, err
}

// CreateRuleBroadcast stores the run as a broadcast of kind 'auto:<key>' to everyone it matches, with
// each recipient's placeholder values. nil when nobody matches (nothing is stored).
func (r *TelegramRulesRepository) CreateRuleBroadcast(ctx context.Context, rule domain.TelegramRule, day service.RuleDay) (*domain.TelegramBroadcast, error) {
	where, err := ruleAudienceWhere(rule.Key)
	if err != nil {
		return nil, err
	}
	var out *domain.TelegramBroadcast
	err = pgx.BeginFunc(ctx, r.pool, func(tx pgx.Tx) error {
		var btnText, btnURL *string
		if rule.Button != nil {
			btnText, btnURL = &rule.Button.Text, &rule.Button.URL
		}
		b, err := scanBroadcast(tx.QueryRow(ctx, `INSERT INTO telegram_broadcasts (kind, target, text_ru, text_uz, text_en, button_text, button_url, status)
			VALUES ($1, 'all', $2, $3, $4, $5, $6, 'queued') RETURNING `+broadcastCols,
			"auto:"+rule.Key, rule.Text.RU, rule.Text.UZ, rule.Text.EN, btnText, btnURL))
		if err != nil {
			return err
		}
		tag, err := tx.Exec(ctx, `INSERT INTO telegram_broadcast_recipients (broadcast_id, user_id, params)
			SELECT $4::bigint, u.id, jsonb_build_object('name', COALESCE(u.full_name, ''), 'count', due.n::text)`+ruleAudienceFrom+where,
			day.Today, day.Start, day.Now, b.ID)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return errNobody // nobody to write to: store nothing
		}
		b.Total = int(tag.RowsAffected())
		if _, err := tx.Exec(ctx, `UPDATE telegram_broadcasts SET total = $2 WHERE id = $1`, b.ID, b.Total); err != nil {
			return err
		}
		out = &b
		return nil
	})
	if errors.Is(err, errNobody) {
		return nil, nil
	}
	return out, err
}

// Recipient finds the Telegram chat of a user for a service message: the notifications switch does not
// matter, a blocked bot does (found = false). name is the profile name ("" when not set).
func (r *TelegramRulesRepository) Recipient(ctx context.Context, userID uuid.UUID) (service.RuleRecipient, bool, error) {
	var x service.RuleRecipient
	err := r.pool.QueryRow(ctx, `SELECT telegram_chat_id, COALESCE(telegram_lang, 'ru'), COALESCE(full_name, '')
		FROM users WHERE id = $1 AND telegram_chat_id IS NOT NULL AND telegram_blocked_at IS NULL`, userID).Scan(&x.ChatID, &x.Lang, &x.Name)
	if errors.Is(err, pgx.ErrNoRows) {
		return x, false, nil
	}
	return x, err == nil, err
}

// MarkBlocked: Telegram refused a message to the user with 403.
func (r *TelegramRulesRepository) MarkBlocked(ctx context.Context, userID uuid.UUID) error {
	_, err := r.pool.Exec(ctx, `UPDATE users SET telegram_blocked_at = now() WHERE id = $1 AND telegram_chat_id IS NOT NULL`, userID)
	return err
}
