-- Linking a Telegram account through the bot: one-time codes in the deep link (t.me/<bot>?start=<code>)
-- and the private chat id the bot can write to later.
CREATE TABLE telegram_link_codes (
    code       TEXT PRIMARY KEY,
    user_id    UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at    TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX telegram_link_codes_user_id_idx ON telegram_link_codes (user_id);

ALTER TABLE users ADD COLUMN telegram_chat_id BIGINT NULL;
-- One Telegram account belongs to one user: binding it again moves it.
CREATE UNIQUE INDEX users_telegram_chat_id_key ON users (telegram_chat_id) WHERE telegram_chat_id IS NOT NULL;
