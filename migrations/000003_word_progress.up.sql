-- Additive only: existing tables are untouched. Missing row = box 1, due today.
CREATE TABLE IF NOT EXISTS word_progress (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    word_id                 UUID        NOT NULL UNIQUE REFERENCES word_cards (id) ON DELETE CASCADE,
    user_id                 UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    box_level               SMALLINT    NOT NULL DEFAULT 1 CHECK (box_level BETWEEN 1 AND 5),
    correct_streak_at_max   SMALLINT    NOT NULL DEFAULT 0,
    is_learned              BOOLEAN     NOT NULL DEFAULT false,
    next_review_at          DATE        NOT NULL DEFAULT CURRENT_DATE,
    last_reviewed_at        TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_word_progress_due ON word_progress (user_id, is_learned, next_review_at);
