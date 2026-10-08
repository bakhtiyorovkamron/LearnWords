-- Language the user learns; chosen once at registration. Existing users keep German.
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS learning_language TEXT NOT NULL DEFAULT 'de'
        CHECK (learning_language IN ('de', 'en', 'fr', 'ko'));
