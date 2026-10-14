-- Word check (POST /api/words/check) and story proofreading.

-- Grammar of a saved word, kept apart from the text the user typed (word_cards.word is never
-- rewritten without the user's consent). All nullable: unknown for older words until checked.
ALTER TABLE word_cards ADD COLUMN IF NOT EXISTS lemma          TEXT;
ALTER TABLE word_cards ADD COLUMN IF NOT EXISTS article        TEXT;
ALTER TABLE word_cards ADD COLUMN IF NOT EXISTS plural         TEXT;
ALTER TABLE word_cards ADD COLUMN IF NOT EXISTS part_of_speech TEXT;

-- AI check results, shared by all users. Key: "<version>:<learning>:<native>:<text>"
-- (text with collapsed spaces, case kept — "essen" and "Essen" are different words).
CREATE TABLE IF NOT EXISTS word_check_cache (
    cache_key   TEXT PRIMARY KEY,
    result_json JSONB       NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Suggestions from the admin job "check existing words". Nothing is applied automatically:
-- the user accepts or rejects each one.
CREATE TABLE IF NOT EXISTS word_fix_suggestions (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    word_id        UUID        NOT NULL REFERENCES word_cards (id) ON DELETE CASCADE,
    original_word  TEXT        NOT NULL,
    suggested_word TEXT        NOT NULL,
    lemma          TEXT        NOT NULL,
    article        TEXT,
    plural         TEXT,
    part_of_speech TEXT        NOT NULL,
    reason         TEXT        NOT NULL DEFAULT '',
    status         TEXT        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at    TIMESTAMPTZ,
    -- re-running the job never duplicates (or resurrects a rejected) suggestion
    UNIQUE (word_id, suggested_word)
);
CREATE INDEX IF NOT EXISTS idx_word_fix_user_pending ON word_fix_suggestions (user_id) WHERE status = 'pending';

-- Story proofreading: outcome per story + every correction made (statistics: how many
-- mistakes the second AI pass catches).
ALTER TABLE daily_stories ADD COLUMN IF NOT EXISTS proofread_status TEXT NOT NULL DEFAULT 'none'
    CHECK (proofread_status IN ('none', 'checked', 'failed'));

CREATE TABLE IF NOT EXISTS story_corrections (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    story_id   UUID        NOT NULL REFERENCES daily_stories (id) ON DELETE CASCADE,
    user_id    UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    from_text  TEXT        NOT NULL,
    to_text    TEXT        NOT NULL,
    why        TEXT        NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_story_corrections_created ON story_corrections (created_at);
