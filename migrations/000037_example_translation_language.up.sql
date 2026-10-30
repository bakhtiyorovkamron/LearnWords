ALTER TABLE word_cards ADD COLUMN IF NOT EXISTS example_translation_language TEXT;
UPDATE word_cards SET example_translation_language = 'ru' WHERE example_translation ~ '[А-Яа-яЁё]';
UPDATE word_cards SET example_translation_language = translation_language WHERE example_translation_language IS NULL AND btrim(example_translation) <> '';
