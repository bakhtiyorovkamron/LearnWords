-- When the bot bound the user's Telegram (admin stats: links made in the last 7 days); NULL while
-- not connected. Accounts linked before this column get the time their link code was used.
ALTER TABLE users ADD COLUMN telegram_linked_at TIMESTAMPTZ NULL;

UPDATE users u SET telegram_linked_at = c.used_at
FROM (SELECT user_id, max(used_at) AS used_at FROM telegram_link_codes WHERE used_at IS NOT NULL GROUP BY user_id) c
WHERE c.user_id = u.id AND u.telegram_chat_id IS NOT NULL;
