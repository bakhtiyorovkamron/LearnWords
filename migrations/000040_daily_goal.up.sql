-- Daily goal: how many words a day the user wants to review (10 | 20 | 30 | 50).
ALTER TABLE users ADD COLUMN IF NOT EXISTS daily_goal SMALLINT NOT NULL DEFAULT 20 CHECK (daily_goal IN (10, 20, 30, 50));

-- The days on which the goal was reached (the Home week strip draws a check mark for them).
CREATE TABLE IF NOT EXISTS goal_days (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    day     DATE NOT NULL,
    PRIMARY KEY (user_id, day)
);
