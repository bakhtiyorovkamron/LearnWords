package service

import (
	"context"

	"github.com/google/uuid"

	"learnwords/internal/domain"
)

// WordQuotaReader reads a user's word count, Telegram link and role (for the profile; the inserts
// read the same thing themselves, inside their transaction).
type WordQuotaReader interface {
	WordQuota(ctx context.Context, userID uuid.UUID) (domain.WordQuota, error)
}

// WordLimit is the rule "without a linked Telegram, at most N words". It is the one check behind
// every path that adds words (a word added by hand or from the search or a photo, a shared folder,
// the starter folder): each passes Guard() to its insert, which runs it inside the transaction.
//
// Linked users and admins have no limit. The rule is off when N is 0 or the bot is not configured:
// nobody may be locked out by a bot they cannot link. Words over the limit are never deleted or
// hidden — the user only cannot add new ones (reviewing does not go through here at all).
type WordLimit struct {
	store WordQuotaReader
	limit int // 0 = the rule is off
}

func NewWordLimit(store WordQuotaReader, limit int, botEnabled bool) *WordLimit {
	if !botEnabled || limit < 0 {
		limit = 0
	}
	return &WordLimit{store: store, limit: limit}
}

func (l *WordLimit) on() bool { return l != nil && l.limit > 0 }

// LimitFor is the limit that applies to a user in state q; nil = none (rule off, linked, admin).
func (l *WordLimit) LimitFor(q domain.WordQuota) *int {
	if !l.on() || q.TelegramLinked || q.Admin {
		return nil
	}
	n := l.limit
	return &n
}

// Allow says whether n more words may be added to a user in state q: a *domain.WordLimitError
// (ErrTelegramRequired) when the count would go over the limit. Adding nothing is always allowed.
func (l *WordLimit) Allow(q domain.WordQuota, n int) error {
	limit := l.LimitFor(q)
	if limit == nil || n <= 0 || q.Words+n <= *limit {
		return nil
	}
	return &domain.WordLimitError{Limit: *limit, Words: q.Words}
}

// Guard is Allow for the inserts, or nil when the rule is off (then no row is locked at all).
// Safe on a nil *WordLimit.
func (l *WordLimit) Guard() domain.WordGuard {
	if !l.on() {
		return nil
	}
	return l.Allow
}

// Status is the profile's "words": the count, and the limit that applies to this user (nil = none).
func (l *WordLimit) Status(ctx context.Context, userID uuid.UUID) (domain.WordsStatus, error) {
	q, err := l.store.WordQuota(ctx, userID)
	if err != nil {
		return domain.WordsStatus{}, err
	}
	return domain.WordsStatus{Count: q.Words, Limit: l.LimitFor(q)}, nil
}
