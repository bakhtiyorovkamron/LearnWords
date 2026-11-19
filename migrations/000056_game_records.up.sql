-- Folder games: the best result of each game per user and folder ('all', 'none' or a folder id).
-- Games never touch the Leitner schedule; this is all they keep. best is the time in ms with the
-- penalties for pairs (lower is better), points for the others (higher is better, out of best_of).
CREATE TABLE game_records (
    user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    folder_key TEXT        NOT NULL,  -- 'all' | 'none' | folder uuid
    game       TEXT        NOT NULL,
    best       INTEGER     NOT NULL,  -- pairs: ms incl. penalties (lower is better); others: points (higher is better)
    best_of    INTEGER     NULL,      -- "out of" for 17/20; NULL for pairs
    plays      INTEGER     NOT NULL DEFAULT 1,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, folder_key, game)
);
