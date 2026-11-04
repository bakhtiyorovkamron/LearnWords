-- The exact text the "___" in example_sentence stands for ("schmeckt", "den Tisch"), which is not
-- always the dictionary form of the word. NULL = unknown (old cards, until cmd/backfillgap runs).
ALTER TABLE word_cards ADD COLUMN example_gap_answer TEXT;
