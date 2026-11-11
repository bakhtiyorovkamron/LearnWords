DROP TABLE telegram_broadcast_recipients;
DROP TABLE telegram_broadcasts;
ALTER TABLE users DROP COLUMN telegram_lang, DROP COLUMN telegram_blocked_at, DROP COLUMN telegram_notifications;
