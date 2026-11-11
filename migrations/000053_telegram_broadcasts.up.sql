-- Telegram broadcasts: the user's own switch, whether they blocked the bot, their Telegram language,
-- and the broadcasts the admins send (with one row per recipient, so nobody gets one twice).
ALTER TABLE users
    ADD COLUMN telegram_notifications BOOLEAN     NOT NULL DEFAULT true,
    ADD COLUMN telegram_blocked_at    TIMESTAMPTZ NULL,
    ADD COLUMN telegram_lang          TEXT        NULL CHECK (telegram_lang IN ('ru', 'uz', 'en'));

CREATE TABLE telegram_broadcasts (
    id          BIGSERIAL   PRIMARY KEY,
    admin_id    UUID        NULL,
    kind        TEXT        NOT NULL DEFAULT 'manual',
    target      TEXT        NOT NULL CHECK (target IN ('me', 'all', 'users')),
    text_ru     TEXT        NOT NULL,
    text_uz     TEXT        NULL,
    text_en     TEXT        NULL,
    button_text TEXT        NULL,
    button_url  TEXT        NULL,
    status      TEXT        NOT NULL CHECK (status IN ('queued', 'running', 'done', 'interrupted')),
    total       INT         NOT NULL DEFAULT 0,
    sent        INT         NOT NULL DEFAULT 0,
    failed      INT         NOT NULL DEFAULT 0,
    blocked     INT         NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at TIMESTAMPTZ NULL
);
CREATE INDEX telegram_broadcasts_created_idx ON telegram_broadcasts (created_at DESC);

CREATE TABLE telegram_broadcast_recipients (
    broadcast_id BIGINT NOT NULL REFERENCES telegram_broadcasts (id) ON DELETE CASCADE,
    user_id      UUID   NOT NULL,
    status       TEXT   NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'blocked')),
    PRIMARY KEY (broadcast_id, user_id)
);
