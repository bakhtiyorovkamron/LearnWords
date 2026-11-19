-- "Review later" marks from the cards deck. A marked word is due today and comes first in the
-- training and the deck; the mark goes with its first review answer. The prev_* columns hold what
-- marking changed (only what it changed), so a second tap can undo it exactly.
CREATE TABLE word_repeat_marks (
    word_id             UUID        PRIMARY KEY REFERENCES word_cards(id) ON DELETE CASCADE,
    user_id             UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    marked_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    prev_next_review_at DATE        NULL,
    prev_is_learned     BOOLEAN     NULL,
    prev_paused         BOOLEAN     NOT NULL DEFAULT false
);

CREATE INDEX word_repeat_marks_user_marked_idx ON word_repeat_marks (user_id, marked_at DESC);
