-- Back to migration 50: the purchase threads return to purchase_messages (ids kept, 'user' becomes
-- 'buyer'). Support threads have no place there and are dropped.
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
    author_user_id UUID        NULL,
    body           TEXT        NULL,
    image_key      TEXT        NULL REFERENCES purchase_message_images (key) ON DELETE CASCADE,
    hidden         BOOLEAN     NOT NULL DEFAULT false,
    hidden_reason  TEXT        NULL,
    event          TEXT        NULL CHECK (event IN ('paid', 'cancelled')),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (body IS NOT NULL OR image_key IS NOT NULL)
);
CREATE INDEX purchase_messages_request_id_idx ON purchase_messages (request_id, id);

ALTER TABLE purchase_requests ADD COLUMN last_message_at TIMESTAMPTZ NULL, ADD COLUMN admin_read_message_id BIGINT NULL;

INSERT INTO purchase_message_images (key, request_id, content_type, data, created_at)
SELECT i.key, t.purchase_request_id, i.content_type, i.data, i.created_at
FROM chat_images i JOIN chat_threads t ON t.id = i.thread_id
WHERE t.kind = 'purchase';

INSERT INTO purchase_messages (id, request_id, author_role, author_user_id, body, image_key, hidden, hidden_reason, event, created_at)
SELECT m.id, t.purchase_request_id, CASE m.author_role WHEN 'user' THEN 'buyer' ELSE m.author_role END,
       m.author_user_id, m.body, m.image_key, m.hidden, m.hidden_reason, m.event, m.created_at
FROM chat_messages m JOIN chat_threads t ON t.id = m.thread_id
WHERE t.kind = 'purchase';

SELECT setval(pg_get_serial_sequence('purchase_messages', 'id'), COALESCE((SELECT max(id) FROM purchase_messages), 0) + 1, false);

UPDATE purchase_requests p SET last_message_at = t.last_message_at, admin_read_message_id = t.admin_read_message_id
FROM chat_threads t WHERE t.kind = 'purchase' AND t.purchase_request_id = p.id;

DROP TABLE chat_messages;
DROP TABLE chat_images;
DROP TABLE chat_threads;
