-- Allow Uzbek ('uz') as an interface (UI) language. Existing values are unchanged.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_interface_language_check;
ALTER TABLE users ADD CONSTRAINT users_interface_language_check
    CHECK (interface_language IS NULL OR interface_language IN ('ru', 'en', 'uz'));
