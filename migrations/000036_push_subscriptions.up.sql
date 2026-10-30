-- Web Push: one row per browser/device subscription. The endpoint identifies the device and is
-- unique: a device that logs in as another user is reassigned to that user.
CREATE TABLE push_subscriptions (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    endpoint        TEXT        NOT NULL UNIQUE,
    p256dh          TEXT        NOT NULL,
    auth            TEXT        NOT NULL,
    user_agent      TEXT        NOT NULL DEFAULT '',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_success_at TIMESTAMPTZ
);
CREATE INDEX idx_push_subscriptions_user ON push_subscriptions (user_id);
