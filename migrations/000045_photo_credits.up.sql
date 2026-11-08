-- Purchased units of a limited feature (photo_import). Spent only after the free daily limit and
-- never expire. The row is also the per-(user, feature) lock every credit movement takes.
CREATE TABLE feature_credits (
    user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    feature    TEXT        NOT NULL,
    balance    INT         NOT NULL DEFAULT 0 CHECK (balance >= 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, feature)
);

-- A user's request to buy a pack, paid by a manual card transfer and approved by an admin.
-- code ("YD-1234") is what the user writes in the transfer comment; unique among pending requests
-- only, so codes are reused once a request is decided.
CREATE TABLE purchase_requests (
    id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code       TEXT        NOT NULL,
    pack_id    TEXT        NOT NULL,
    feature    TEXT        NOT NULL,
    amount     INT         NOT NULL CHECK (amount > 0),
    price_uzs  INT         NOT NULL,
    status     TEXT        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'rejected', 'cancelled')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    decided_at TIMESTAMPTZ,
    decided_by UUID        REFERENCES users(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX idx_purchase_requests_pending_code ON purchase_requests (code) WHERE status = 'pending';
CREATE INDEX idx_purchase_requests_user ON purchase_requests (user_id, created_at DESC);
CREATE INDEX idx_purchase_requests_status ON purchase_requests (status, created_at);

-- Audit log of credit grants: one row per approved purchase or admin correction (not per photo spent).
-- purchase_id / created_by are plain ids, not foreign keys: the record outlives the request and the admin.
CREATE TABLE credit_ledger (
    id          BIGSERIAL   PRIMARY KEY,
    user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    feature     TEXT        NOT NULL,
    delta       INT         NOT NULL,
    reason      TEXT        NOT NULL CHECK (reason IN ('purchase', 'admin', 'refund')),
    purchase_id UUID,
    created_by  UUID,
    note        TEXT        NOT NULL DEFAULT '',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_credit_ledger_user ON credit_ledger (user_id, created_at DESC);
