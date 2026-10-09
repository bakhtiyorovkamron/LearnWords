-- Per-word translation cache, keyed by native/interface language (ru|en|uz), separate from
-- word_cards.translation (which is whatever language was active when the word was added).
-- Lets the same word be shown correctly to a user in any interface language without guessing.
CREATE TABLE IF NOT EXISTS word_translations (
    word_id              UUID        NOT NULL REFERENCES word_cards(id) ON DELETE CASCADE,
    language             TEXT        NOT NULL,
    translation          TEXT        NOT NULL,
    example_translation  TEXT        NOT NULL DEFAULT '',
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (word_id, language)
);

-- Backfill: every word added before this table existed was translated into whatever interface
-- language was active at the time, which — before Uzbek/English support — was always Russian
-- (see the "Russian-only translations" comments in migrations 000014/000015). Seed those as the
-- "ru" cache entry so existing Russian-interface users never need a fresh AI call for words they
-- already have.
INSERT INTO word_translations (word_id, language, translation, example_translation)
SELECT id, 'ru', translation, COALESCE(example_translation, '')
FROM word_cards
WHERE btrim(translation) <> ''
ON CONFLICT (word_id, language) DO NOTHING;
