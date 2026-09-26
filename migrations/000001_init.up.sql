CREATE TABLE IF NOT EXISTS users (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email         TEXT        NOT NULL UNIQUE,
    password_hash TEXT        NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS contexts (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    image_url   TEXT,
    source_text TEXT        NOT NULL,
    language    VARCHAR(8)  NOT NULL DEFAULT 'de',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contexts_user_created ON contexts (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS word_cards (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    context_id    UUID        NOT NULL REFERENCES contexts (id) ON DELETE CASCADE,
    user_id       UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    word          TEXT        NOT NULL,
    translation   TEXT        NOT NULL DEFAULT '',
    transcription TEXT        NOT NULL DEFAULT '',
    audio_url     TEXT,
    language      VARCHAR(8)  NOT NULL DEFAULT 'de',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_word_cards_user_created ON word_cards (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_word_cards_context ON word_cards (context_id);
