-- The colour theme a user picked (NULL = never chose: the default, night green).
ALTER TABLE users ADD COLUMN IF NOT EXISTS theme TEXT
    CHECK (theme IN ('auto', 'night', 'light', 'graphite', 'sand', 'navy'));
