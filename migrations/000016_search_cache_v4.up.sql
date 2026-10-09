-- Search cache keys are now "v4:<learning>:<native>:<query>" (two-step resolve+assemble lookup
-- with server-side validation). Drop every older entry: queries where a native-language word
-- (e.g. Uzbek "sen", "u") leaked into the German "word"/"example_sentence" unresolved.
DELETE FROM word_search_cache WHERE query_normalized NOT LIKE 'v4:%';
