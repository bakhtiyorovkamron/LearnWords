-- The chat inside a purchase request: the buyer, the admins and system lines (paid / cancelled).
-- Photos are kept in purchase_message_images; a message only holds the key.
CREATE TABLE purchase_message_images (
    key          TEXT        PRIMARY KEY,
    request_id   UUID        NOT NULL REFERENCES purchase_requests (id) ON DELETE CASCADE,
    content_type TEXT        NOT NULL,
    data         BYTEA       NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE purchase_messages (
    id             BIGSERIAL   PRIMARY KEY,
    request_id     UUID        NOT NULL REFERENCES purchase_requests (id) ON DELETE CASCADE,
    author_role    TEXT        NOT NULL CHECK (author_role IN ('buyer', 'admin', 'system')),
    -- A plain id (users.id is a UUID), no foreign key: a message outlives a deleted admin.
    author_user_id UUID        NULL,
    body           TEXT        NULL,
    image_key      TEXT        NULL REFERENCES purchase_message_images (key) ON DELETE CASCADE,
    -- hidden: the text looks like a card number (hidden_reason 'card_number'); only admins and the
    -- author's side see the message.
    hidden         BOOLEAN     NOT NULL DEFAULT false,
    hidden_reason  TEXT        NULL,
    -- System lines: what happened, so the client can show it in the user's language.
    event          TEXT        NULL CHECK (event IN ('paid', 'cancelled')),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (body IS NOT NULL OR image_key IS NOT NULL)
);
CREATE INDEX purchase_messages_request_id_idx ON purchase_messages (request_id, id);

ALTER TABLE purchase_requests ADD COLUMN last_message_at TIMESTAMPTZ NULL;
-- The newest message an admin has read; the unread badge counts buyer messages after it.
ALTER TABLE purchase_requests ADD COLUMN admin_read_message_id BIGINT NULL;
