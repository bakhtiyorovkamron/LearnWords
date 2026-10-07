-- Cache of AI word-search results (dictionary data rarely changes).
CREATE TABLE IF NOT EXISTS word_search_cache (
    id               BIGSERIAL PRIMARY KEY,
    query_normalized TEXT        NOT NULL UNIQUE,
    result_json      JSONB       NOT NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at       TIMESTAMPTZ NOT NULL DEFAULT now() + INTERVAL '90 days'
);
