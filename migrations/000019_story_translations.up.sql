-- Per-story translation cache, keyed by native/interface language (ru|en|uz), separate from
-- daily_stories.story_de (the shared German text every viewer sees regardless of UI language).
CREATE TABLE IF NOT EXISTS story_translations (
    story_id         UUID        NOT NULL REFERENCES daily_stories(id) ON DELETE CASCADE,
    lang             TEXT        NOT NULL,
    translation_text TEXT        NOT NULL,
    word_glosses     JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (story_id, lang)
);

-- Backfill: every story generated before this table existed was translated into Russian only
-- (story_ru + the gloss baked into words_used at the time). Seed those as the "ru" cache entry
-- so Russian-interface users never need a fresh AI call for a story they already have.
INSERT INTO story_translations (story_id, lang, translation_text, word_glosses)
SELECT id, 'ru', story_ru,
       COALESCE((SELECT jsonb_object_agg(elem->>'word', elem->>'translation')
                 FROM jsonb_array_elements(words_used) elem
                 WHERE elem->>'word' IS NOT NULL), '{}'::jsonb)
FROM daily_stories
WHERE btrim(story_ru) <> ''
ON CONFLICT (story_id, lang) DO NOTHING;

-- story_ru is superseded by story_translations; new stories no longer populate it.
ALTER TABLE daily_stories ALTER COLUMN story_ru DROP NOT NULL;
