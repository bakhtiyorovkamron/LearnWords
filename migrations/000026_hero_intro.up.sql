-- One-time "Meet your German hero!" screen. Anyone who already has a hero (hero_stage set — the
-- early testers) knows it and doesn't get the intro again.
ALTER TABLE users ADD COLUMN IF NOT EXISTS hero_intro_seen BOOLEAN NOT NULL DEFAULT false;
UPDATE users SET hero_intro_seen = true WHERE hero_stage IS NOT NULL;
