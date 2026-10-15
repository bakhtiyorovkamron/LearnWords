-- "unknown"/"error" answers must never be cached (a failed AI call looked like "no such word").
DELETE FROM word_check_cache WHERE result_json->>'status' IN ('unknown', 'error');
