-- Search cache keys now include learning + translation language ("v2:de:uz:daftar").
-- Entries created before that fix (Russian-only translations, query language not detected —
-- e.g. Uzbek "daftar" cached as German "Daftar") are wrong for other users, so drop them.
DELETE FROM word_search_cache WHERE query_normalized NOT LIKE 'v2:%';
