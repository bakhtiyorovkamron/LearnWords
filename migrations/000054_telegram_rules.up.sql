-- Automatic Telegram notifications: four rules an admin switches on and edits (all off after this
-- migration), what one recipient's placeholders hold, and the counters that keep reminders polite.
CREATE TABLE telegram_rules (
    key         TEXT        PRIMARY KEY,
    enabled     BOOLEAN     NOT NULL DEFAULT false,
    send_at     TIME        NULL,
    text_ru     TEXT        NOT NULL,
    text_uz     TEXT        NULL,
    text_en     TEXT        NULL,
    button_text TEXT        NULL,
    button_url  TEXT        NULL,
    last_run_on DATE        NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO telegram_rules (key, enabled, send_at, text_ru, text_uz, text_en, button_text, button_url) VALUES
('review_reminder', false, '19:00',
 'Слов на повторение сегодня: {count}. Это займёт пару минут.',
 'Bugun takrorlash uchun so‘zlar: {count}. Bir necha daqiqa vaqt oladi.',
 'Words to review today: {count}. It takes a couple of minutes.',
 'Открыть Yodla', 'https://yodla.fun'),
('comeback', false, '12:00',
 'Давно не виделись. Слов на повторение накопилось: {count}.',
 'Anchadan beri ko‘rishmadik. Takrorlash uchun yig‘ilgan so‘zlar: {count}.',
 'Long time no see. Words waiting for review: {count}.',
 'Открыть Yodla', 'https://yodla.fun'),
('purchase_paid', false, NULL,
 'Оплата по заявке {code} подтверждена. Начислено фото: {amount}.',
 '{code} buyurtmasi bo‘yicha to‘lov tasdiqlandi. Qo‘shilgan rasmlar: {amount}.',
 'Payment for order {code} is confirmed. Photos added: {amount}.',
 NULL, NULL),
('purchase_rejected', false, NULL,
 'Заявка {code} отклонена. Если это ошибка, напишите в поддержку на сайте.',
 '{code} buyurtmasi rad etildi. Agar bu xato bo‘lsa, saytdagi qo‘llab-quvvatlashga yozing.',
 'Order {code} was declined. If this is a mistake, write to support on the site.',
 NULL, NULL);

-- The values of the placeholders for one recipient of an automatic broadcast ({"name": "...", "count": "12"}).
ALTER TABLE telegram_broadcast_recipients ADD COLUMN params JSONB NULL;

-- Reminders sent in a row without the user reviewing (reset by a review; 3 = stop), and when the last
-- "come back" message went out (one per absence).
ALTER TABLE users
    ADD COLUMN telegram_reminders_unanswered INT         NOT NULL DEFAULT 0,
    ADD COLUMN telegram_comeback_sent_at     TIMESTAMPTZ NULL;
