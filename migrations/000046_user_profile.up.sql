-- Profile: name, phone (E.164, +998XXXXXXXXX) and the Telegram username (set only by the bot, later).
ALTER TABLE users
    ADD COLUMN full_name         TEXT NULL,
    ADD COLUMN phone             TEXT NULL,
    ADD COLUMN telegram_username TEXT NULL;
