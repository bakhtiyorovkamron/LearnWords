-- Search cache keys are now "v5:<learning>:<native>:<query>": "translation" and
-- "example_translation" are validated against parenthetical grammar/usage explanations
-- (e.g. "sen (odam bilan rasmiy bo'lmagan o'zbek tili)", "будь здоров (повелительное
-- наклонение)") — such remarks now go into the separate "note" field instead.
-- Drop every older entry so already-cached answers get regenerated clean.
DELETE FROM word_search_cache WHERE query_normalized NOT LIKE 'v5:%';
