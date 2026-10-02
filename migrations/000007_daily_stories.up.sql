-- One AI-generated German story per user per day, built from the words added that day.
CREATE TABLE IF NOT EXISTS daily_stories (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    date       DATE        NOT NULL,
    genre      TEXT        NOT NULL DEFAULT '',
    title      TEXT        NOT NULL DEFAULT '',
    story_de   TEXT        NOT NULL,
    story_ru   TEXT        NOT NULL,
    words_used JSONB       NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, date)
);

CREATE INDEX IF NOT EXISTS idx_daily_stories_user_date ON daily_stories (user_id, date DESC);
