ALTER TABLE daily_stories ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'ai' CHECK (source IN ('ai', 'user'));
ALTER TABLE daily_stories DROP CONSTRAINT IF EXISTS daily_stories_user_id_date_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_daily_stories_ai_user_date ON daily_stories (user_id, date) WHERE source = 'ai';
ALTER TABLE story_translations ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'ai' CHECK (source IN ('ai', 'user'));
