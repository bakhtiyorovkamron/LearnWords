-- The language word_cards.translation / example_translation are written in. Training shows the
-- card's own translation when it is in the user's interface language, and only asks AI (with the
-- card's meaning as a hint) for other languages.
ALTER TABLE word_cards ADD COLUMN IF NOT EXISTS translation_language TEXT;

-- Backfill: Cyrillic text is Russian (the app was Russian-only before en/uz were added).
UPDATE word_cards SET translation_language = 'ru'
WHERE translation_language IS NULL AND translation ~ '[А-Яа-яЁё]';

-- Repair: the cached translation in the card's own language must equal the card's translation
-- (an AI re-translation had replaced it: "still" = "тихий, спокойный" showed up as "ещё").
UPDATE word_translations wt
SET translation = wc.translation,
    example_translation = COALESCE(wc.example_translation, '')
FROM word_cards wc
WHERE wt.word_id = wc.id
  AND wt.language = wc.translation_language
  AND btrim(wc.translation) <> ''
  AND wt.translation <> wc.translation;
