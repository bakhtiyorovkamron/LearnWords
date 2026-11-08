ALTER TABLE users
    DROP COLUMN IF EXISTS telegram_username,
    DROP COLUMN IF EXISTS phone,
    DROP COLUMN IF EXISTS full_name;
