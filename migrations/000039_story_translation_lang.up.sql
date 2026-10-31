-- One fixed translation language per story: it is translated once and stays that way, whatever the
-- interface language is later. NULL = not fixed yet; the first open fixes it.
ALTER TABLE daily_stories ADD COLUMN IF NOT EXISTS translation_lang TEXT NULL;

-- Backfill: the language of the EARLIEST cached translation of each story (a tie → 'ru').
-- Stories without any translation row stay NULL.
UPDATE daily_stories s
SET translation_lang = (
    SELECT t.lang
    FROM story_translations t
    WHERE t.story_id = s.id
    ORDER BY t.created_at ASC, (t.lang = 'ru') DESC, t.lang ASC
    LIMIT 1
)
WHERE EXISTS (SELECT 1 FROM story_translations t WHERE t.story_id = s.id);
