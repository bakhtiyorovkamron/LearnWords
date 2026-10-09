UPDATE users SET interface_language = 'ru' WHERE interface_language = 'uz';
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_interface_language_check;
ALTER TABLE users ADD CONSTRAINT users_interface_language_check
    CHECK (interface_language IS NULL OR interface_language IN ('ru', 'en'));
