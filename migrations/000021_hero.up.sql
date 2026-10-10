-- Tracks the highest "German hero" growth stage ever reached, so the hero never regresses
-- even if some learned words later slip back to a lower Leitner box. NULL = never computed yet.
ALTER TABLE users ADD COLUMN IF NOT EXISTS hero_stage SMALLINT;
