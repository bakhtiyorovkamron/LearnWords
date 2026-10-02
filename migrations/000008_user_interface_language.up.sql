-- Interface (UI) language chosen by the user; NULL = not chosen yet (client falls back to localStorage/browser).
ALTER TABLE users ADD COLUMN IF NOT EXISTS interface_language VARCHAR(8)
    CHECK (interface_language IS NULL OR interface_language IN ('ru', 'en'));
