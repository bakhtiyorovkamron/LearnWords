ALTER TABLE users DROP COLUMN telegram_comeback_sent_at, DROP COLUMN telegram_reminders_unanswered;
ALTER TABLE telegram_broadcast_recipients DROP COLUMN params;
DROP TABLE telegram_rules;
