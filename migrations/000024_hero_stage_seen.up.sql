-- Highest hero stage whose "your hero grew up" congratulation the user has already seen
-- (POST /api/hero/stage-seen). stage_up = hero_stage > hero_stage_seen.
ALTER TABLE users ADD COLUMN IF NOT EXISTS hero_stage_seen SMALLINT;
-- Existing heroes: their current stage counts as seen — no congratulation for old growth.
UPDATE users SET hero_stage_seen = hero_stage WHERE hero_stage_seen IS NULL AND hero_stage IS NOT NULL;
