ALTER TABLE purchase_requests DROP COLUMN IF EXISTS admin_read_message_id;
ALTER TABLE purchase_requests DROP COLUMN IF EXISTS last_message_at;
DROP TABLE IF EXISTS purchase_messages;
DROP TABLE IF EXISTS purchase_message_images;
