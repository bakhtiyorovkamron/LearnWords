-- Optional user folders for grouping words. Purely organisational:
-- progress, training logic, stories and stats do not depend on folders.
CREATE TABLE IF NOT EXISTS folders (
    id         UUID PRIMARY KEY,
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name       VARCHAR(50) NOT NULL,
    color      VARCHAR(20) NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS folders_user_idx ON folders (user_id, created_at);

-- NULL = "no folder" (all existing words stay as they are).
-- Deleting a folder keeps its words, they just become folder-less.
ALTER TABLE word_cards ADD COLUMN IF NOT EXISTS folder_id UUID REFERENCES folders(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS word_cards_folder_idx ON word_cards (folder_id) WHERE folder_id IS NOT NULL;
