-- Search cache keys are now "v3:<learning>:<native>:<query>" (native-language-first prompt).
-- Drop every older entry: Russian-only translations and wrong look-alike matches
-- such as Uzbek "men" → der Mensch and "daftar" → Daftar.
DELETE FROM word_search_cache WHERE query_normalized NOT LIKE 'v3:%';
