-- Remembers the user's last chosen training-session size, synced across devices
-- (see also localStorage fallback on the client).
ALTER TABLE users ADD COLUMN IF NOT EXISTS review_session_size VARCHAR(8)
    CHECK (review_session_size IS NULL OR review_session_size IN ('10', '20', '50', 'all'));
