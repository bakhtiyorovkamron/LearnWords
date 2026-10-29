UPDATE word_cards SET audio_url = NULL WHERE audio_url LIKE 'mock://%';
ALTER TABLE contexts DROP COLUMN IF EXISTS image_url;
ALTER TABLE contexts DROP COLUMN IF EXISTS photo_credit;
ALTER TABLE daily_stories DROP COLUMN IF EXISTS story_ru;
