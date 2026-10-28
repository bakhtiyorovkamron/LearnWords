-- One answer per user to the "how do you like the app?" window: a rating (1-5, optional comment),
-- or dismissed = true when the window was closed without rating. Either way it is never asked again.
CREATE TABLE feedback (
    user_id    UUID        PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    rating     SMALLINT    CHECK (rating BETWEEN 1 AND 5),
    comment    TEXT        NOT NULL DEFAULT '',
    dismissed  BOOLEAN     NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (dismissed OR rating IS NOT NULL)
);
