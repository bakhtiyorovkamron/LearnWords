package postgres

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"learnwords/internal/domain"
)

// userWords is "a user's words" in SQL — every card of the user — with the user given as an SQL
// expression ("u.id", "$1"). It is the ONE definition behind AdminUser.WordsCount (the admin user
// list), the profile's words.count and the word limit without Telegram, so they never disagree.
func userWords(user string) string { return `FROM word_cards WHERE user_id = ` + user }

var countUserWordsSQL = `SELECT count(*) ` + userWords("$1")

// rowQuerier is a pool or a transaction.
type rowQuerier interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// readWordQuota reads the user's role, Telegram link and word count. lock (inside a transaction)
// locks the user row first: FOR NO KEY UPDATE makes parallel adds of the same user wait for each
// other, while the FOR KEY SHARE locks of ordinary inserts referencing users do not wait.
//
// The count is a statement of its own, AFTER the lock: under READ COMMITTED (the default) it then
// sees the words a parallel request committed while this one waited. Folded into the locking
// statement it would count from the snapshot taken before the wait, and two requests at 49 would
// both pass.
func readWordQuota(ctx context.Context, q rowQuerier, userID uuid.UUID, lock bool) (domain.WordQuota, error) {
	var wq domain.WordQuota
	sql := `SELECT role = 'admin', telegram_chat_id IS NOT NULL FROM users WHERE id = $1`
	if lock {
		sql += ` FOR NO KEY UPDATE`
	}
	err := q.QueryRow(ctx, sql, userID).Scan(&wq.Admin, &wq.TelegramLinked)
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.WordQuota{}, domain.ErrNotFound
	}
	if err != nil {
		return domain.WordQuota{}, err
	}
	if err := q.QueryRow(ctx, countUserWordsSQL, userID).Scan(&wq.Words); err != nil {
		return domain.WordQuota{}, err
	}
	return wq, nil
}

// guardWords runs the word limit (guard; nil = the rule is off) for adding n words to userID, inside
// tx and before the inserts: the user row stays locked until tx ends.
func guardWords(ctx context.Context, tx pgx.Tx, userID uuid.UUID, n int, guard domain.WordGuard) error {
	if guard == nil {
		return nil
	}
	q, err := readWordQuota(ctx, tx, userID, true)
	if err != nil {
		return err
	}
	return guard(q, n)
}

// WordQuota is the user's word count, Telegram link and role, unlocked (for the profile).
func (r *UserRepository) WordQuota(ctx context.Context, id uuid.UUID) (domain.WordQuota, error) {
	return readWordQuota(ctx, r.pool, id, false)
}
