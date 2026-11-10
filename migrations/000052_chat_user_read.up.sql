-- The newest message the user has read in the thread (mirrors admin_read_message_id): the user's
-- unread badge counts the admins' and system messages after it.
ALTER TABLE chat_threads ADD COLUMN user_read_message_id BIGINT NULL;

-- Everything written before this deploy counts as read, so old history is not "unread".
UPDATE chat_threads t
SET user_read_message_id = (SELECT max(m.id) FROM chat_messages m WHERE m.thread_id = t.id);
