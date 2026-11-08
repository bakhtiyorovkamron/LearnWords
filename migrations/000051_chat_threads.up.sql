-- One chat model for every conversation with the admins: each user's support thread and the
-- thread of each purchase request. It replaces purchase_messages / purchase_message_images
-- (migration 50): their rows move here with their ids (a client polling ?after=<id> keeps working),
-- 'buyer' becomes 'user', and the old tables and columns go.
CREATE TABLE chat_threads (
    id                    BIGSERIAL   PRIMARY KEY,
    kind                  TEXT        NOT NULL CHECK (kind IN ('support', 'purchase')),
    user_id               UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    purchase_request_id   UUID        NULL REFERENCES purchase_requests (id) ON DELETE CASCADE,
    last_message_at       TIMESTAMPTZ NULL,
    -- The newest message an admin has read: the unread badge counts the user's messages after it.
    admin_read_message_id BIGINT      NULL,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK ((kind = 'purchase') = (purchase_request_id IS NOT NULL))
);
CREATE UNIQUE INDEX chat_threads_support_user_key ON chat_threads (user_id) WHERE kind = 'support';
CREATE UNIQUE INDEX chat_threads_purchase_request_key ON chat_threads (purchase_request_id) WHERE kind = 'purchase';
CREATE INDEX chat_threads_kind_last_message_idx ON chat_threads (kind, last_message_at DESC);

-- Chat photos (≤ 5 MB); a message holds only the key.
CREATE TABLE chat_images (
    key          TEXT        PRIMARY KEY,
    thread_id    BIGINT      NOT NULL REFERENCES chat_threads (id) ON DELETE CASCADE,
    content_type TEXT        NOT NULL,
    data         BYTEA       NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE chat_messages (
    id             BIGSERIAL   PRIMARY KEY,
    thread_id      BIGINT      NOT NULL REFERENCES chat_threads (id) ON DELETE CASCADE,
    author_role    TEXT        NOT NULL CHECK (author_role IN ('user', 'admin', 'system')),
    -- A plain id (users.id is a UUID), no foreign key: a message outlives a deleted admin.
    author_user_id UUID        NULL,
    body           TEXT        NULL,
    image_key      TEXT        NULL REFERENCES chat_images (key) ON DELETE CASCADE,
    -- hidden: the text looks like a card number (hidden_reason 'card_number'); only the admins and
    -- the author's side see the message.
    hidden         BOOLEAN     NOT NULL DEFAULT false,
    hidden_reason  TEXT        NULL,
    -- System lines of a purchase thread: what happened, shown in the user's language.
    event          TEXT        NULL CHECK (event IN ('paid', 'cancelled')),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (body IS NOT NULL OR image_key IS NOT NULL)
);
CREATE INDEX chat_messages_thread_id_idx ON chat_messages (thread_id, id);

-- The order chats move over: one purchase thread per request that has messages.
INSERT INTO chat_threads (kind, user_id, purchase_request_id, last_message_at, admin_read_message_id, created_at)
SELECT 'purchase', p.user_id, p.id, p.last_message_at, p.admin_read_message_id,
       (SELECT min(m.created_at) FROM purchase_messages m WHERE m.request_id = p.id)
FROM purchase_requests p
WHERE EXISTS (SELECT 1 FROM purchase_messages m WHERE m.request_id = p.id);

INSERT INTO chat_images (key, thread_id, content_type, data, created_at)
SELECT i.key, t.id, i.content_type, i.data, i.created_at
FROM purchase_message_images i
JOIN chat_threads t ON t.kind = 'purchase' AND t.purchase_request_id = i.request_id;

INSERT INTO chat_messages (id, thread_id, author_role, author_user_id, body, image_key, hidden, hidden_reason, event, created_at)
SELECT m.id, t.id, CASE m.author_role WHEN 'buyer' THEN 'user' ELSE m.author_role END,
       m.author_user_id, m.body, m.image_key, m.hidden, m.hidden_reason, m.event, m.created_at
FROM purchase_messages m
JOIN chat_threads t ON t.kind = 'purchase' AND t.purchase_request_id = m.request_id;

-- New messages continue after the moved ids.
SELECT setval(pg_get_serial_sequence('chat_messages', 'id'), COALESCE((SELECT max(id) FROM chat_messages), 0) + 1, false);

DROP TABLE purchase_messages;
DROP TABLE purchase_message_images;
ALTER TABLE purchase_requests DROP COLUMN last_message_at, DROP COLUMN admin_read_message_id;
