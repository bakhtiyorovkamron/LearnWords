-- Training sounds on/off, synced across devices (localStorage on the client is the fallback).
ALTER TABLE users ADD COLUMN IF NOT EXISTS sounds_enabled BOOLEAN NOT NULL DEFAULT true;
