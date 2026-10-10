DROP TABLE IF EXISTS story_translations;
-- story_ru is left nullable: restoring NOT NULL could fail on stories created after the up
-- migration (which never populate it).
