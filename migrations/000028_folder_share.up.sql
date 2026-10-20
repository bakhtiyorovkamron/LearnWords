-- Shareable folders: a public link shows the words and lets anyone import a COPY.
ALTER TABLE folders ADD COLUMN IF NOT EXISTS share_token TEXT UNIQUE;   -- NULL = not shared
ALTER TABLE folders ADD COLUMN IF NOT EXISTS shared_at TIMESTAMPTZ;
-- The folder this one was imported from (kept as a plain reference; the source may be deleted).
ALTER TABLE folders ADD COLUMN IF NOT EXISTS imported_from UUID REFERENCES folders (id) ON DELETE SET NULL;

-- Who imported which shared folder: the owner's "added by N" counter.
CREATE TABLE IF NOT EXISTS folder_imports (
    folder_id  UUID NOT NULL REFERENCES folders (id) ON DELETE CASCADE,
    user_id    UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (folder_id, user_id)
);
