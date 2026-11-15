package domain

import (
	"errors"
	"fmt"
)

// ErrTelegramRequired: the user has reached the word limit for accounts without a linked Telegram.
// The handler answers 403 with the code "telegram_required", the limit and the current count.
var ErrTelegramRequired = errors.New("link Telegram to add more words")

// WordLimitError is ErrTelegramRequired carrying the limit and how many words the user has now.
type WordLimitError struct {
	Limit int
	Words int
}

func (e *WordLimitError) Error() string {
	return fmt.Sprintf("word limit without Telegram reached (%d of %d)", e.Words, e.Limit)
}
func (e *WordLimitError) Is(target error) bool { return target == ErrTelegramRequired }

// WordLimitOf extracts the limit and the current count from an ErrTelegramRequired.
func WordLimitOf(err error) (limit, words int, ok bool) {
	var e *WordLimitError
	if errors.As(err, &e) {
		return e.Limit, e.Words, true
	}
	return 0, 0, false
}

// WordQuota is what the word limit looks at for one user.
type WordQuota struct {
	Words          int  // the user's words now: the same count as AdminUser.WordsCount
	TelegramLinked bool // users.telegram_chat_id IS NOT NULL
	Admin          bool
}

// WordGuard decides whether n more words may be added to a user in state q (nil error = yes). Every
// path that adds words calls it inside the transaction of the insert, with the user's row locked,
// so two parallel requests cannot both pass the limit. A nil WordGuard means the rule is off.
type WordGuard func(q WordQuota, n int) error

// WordsStatus is the profile's "words": the count and the limit that applies (nil = none).
type WordsStatus struct {
	Count int  `json:"count"`
	Limit *int `json:"limit"`
}
