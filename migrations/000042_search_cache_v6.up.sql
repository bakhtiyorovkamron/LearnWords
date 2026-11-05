-- Search cache keys are now "v6:<learning>:<native>:<query>". Drop every older entry,
DELETE FROM word_search_cache WHERE query_normalized NOT LIKE 'v6:%';
-- Only the cache is affected; words, contexts and progress are untouched.
-- including v5 answers with wrong meanings (men → der Mensch, daftar → Daftar).
