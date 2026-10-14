DROP TABLE IF EXISTS story_corrections;
ALTER TABLE daily_stories DROP COLUMN IF EXISTS proofread_status;
DROP TABLE IF EXISTS word_fix_suggestions;
DROP TABLE IF EXISTS word_check_cache;
ALTER TABLE word_cards DROP COLUMN IF EXISTS part_of_speech;
ALTER TABLE word_cards DROP COLUMN IF EXISTS plural;
ALTER TABLE word_cards DROP COLUMN IF EXISTS article;
ALTER TABLE word_cards DROP COLUMN IF EXISTS lemma;
