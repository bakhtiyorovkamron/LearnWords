-- Interface sounds (taps, page turns) on/off, synced across devices; the training-sounds switch
-- (sounds_enabled) is a master switch above it.
ALTER TABLE users ADD COLUMN IF NOT EXISTS ui_sounds_enabled BOOLEAN NOT NULL DEFAULT true;
