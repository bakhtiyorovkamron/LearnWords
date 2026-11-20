-- Signing in (and up) with Telegram. The site creates a login with two values:
--   code   — "login_" + 32 characters [A-Za-z0-9]. It goes into the t.me deep link
--            (t.me/<bot>?start=<code>), so it is visible: in the address bar, in the history, to
--            anyone the link is forwarded to. It only says WHICH login the bot asks about.
--   secret — 32 random bytes (base64url), returned only to the browser that created the login.
--            Only its sha256 is stored. Only the secret can collect the session, so a leaked link
--            alone signs nobody in.
-- The bot never signs in on /start alone: it asks the chat (device + time) and only the "yes"
-- button from the same chat confirms. A confirmed login is collected once (status 'used').
-- Codes live 5 minutes; expired rows are deleted when new logins are created.
CREATE TABLE telegram_logins (
    code        TEXT        PRIMARY KEY,           -- "login_" + 32 chars [A-Za-z0-9], in the t.me start param
    secret_hash BYTEA       NOT NULL,              -- sha256(secret)
    device      TEXT        NOT NULL,              -- "iPhone · Safari", from the User-Agent
    status      TEXT        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'asked', 'confirmed', 'denied', 'used')),
    chat_id     BIGINT      NULL,                  -- the chat the bot asked (set by /start)
    user_id     UUID        NULL REFERENCES users (id) ON DELETE CASCADE, -- set on "yes"
    new_user    BOOLEAN     NOT NULL DEFAULT false, -- the "yes" created this account
    expires_at  TIMESTAMPTZ NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- The browser polls by its secret.
CREATE UNIQUE INDEX telegram_logins_secret_hash_key ON telegram_logins (secret_hash);

-- An account created by Telegram has not chosen the language it learns yet (asked once, on /welcome).
ALTER TABLE users ADD COLUMN needs_language BOOLEAN NOT NULL DEFAULT false;
