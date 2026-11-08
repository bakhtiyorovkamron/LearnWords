-- The one-time gift for connecting Telegram (photo import credits): once per Telegram account
-- (chat_id) and once per user, so moving one Telegram between accounts earns it only once. Plain
-- ids, no foreign key: the record outlives a deleted account, and linking the same Telegram to a
-- new account earns nothing.
CREATE TABLE telegram_bonuses (
    chat_id    BIGINT      PRIMARY KEY,
    user_id    UUID        NOT NULL UNIQUE,
    credits    INT         NOT NULL CHECK (credits > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE credit_ledger DROP CONSTRAINT credit_ledger_reason_check;
ALTER TABLE credit_ledger ADD CONSTRAINT credit_ledger_reason_check
    CHECK (reason IN ('purchase', 'admin', 'refund', 'telegram'));
