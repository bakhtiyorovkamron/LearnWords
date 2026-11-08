DROP INDEX IF EXISTS users_telegram_chat_id_key;
ALTER TABLE users DROP COLUMN IF EXISTS telegram_chat_id;
DROP TABLE IF EXISTS telegram_link_codes;
