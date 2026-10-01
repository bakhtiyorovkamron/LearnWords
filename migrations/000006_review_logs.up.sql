-- Every training answer. word_id is SET NULL on delete so statistics survive deleted words.
CREATE TABLE IF NOT EXISTS review_logs (
    id          BIGSERIAL PRIMARY KEY,
    user_id     UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    word_id     UUID        REFERENCES word_cards (id) ON DELETE SET NULL,
    is_correct  BOOLEAN     NOT NULL,
    reviewed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_review_logs_user_time ON review_logs (user_id, reviewed_at);
