-- Per-user feature overrides set by the admin. A row exists only when something was overridden;
-- daily_limit NULL = use the feature's default limit.
CREATE TABLE user_features (
    user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    feature     TEXT        NOT NULL,
    enabled     BOOLEAN     NOT NULL DEFAULT true,
    daily_limit INT         CHECK (daily_limit >= 0),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, feature)
);

-- How much of a limited feature a user has used on a given day (Asia/Tashkent calendar day).
CREATE TABLE feature_usage (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    feature TEXT NOT NULL,
    day     DATE NOT NULL,
    count   INT  NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, feature, day)
);
