DELETE FROM daily_stories WHERE source = 'user';
DROP INDEX IF EXISTS uq_daily_stories_ai_user_date;
ALTER TABLE daily_stories ADD CONSTRAINT daily_stories_user_id_date_key UNIQUE (user_id, date);
ALTER TABLE daily_stories DROP COLUMN IF EXISTS source;
ALTER TABLE story_translations DROP COLUMN IF EXISTS source;
