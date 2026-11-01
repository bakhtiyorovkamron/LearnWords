-- A paused card is not in the general training queue yet (the starter "Introductions" folder): it is
-- asked only when the training is narrowed to its folder, and the first review answer unpauses it.
ALTER TABLE word_cards ADD COLUMN IF NOT EXISTS paused BOOLEAN NOT NULL DEFAULT false;
