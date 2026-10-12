-- Tags every answer as a real spaced-repetition review or extra practice. Practice answers
-- still count toward the daily-activity streak (ActiveDays is unfiltered) but are excluded from
-- the accuracy/reviewed-per-day stats (Daily filters to 'review') — they never touched the
-- Leitner schedule, so mixing them into accuracy would be misleading.
ALTER TABLE review_logs ADD COLUMN IF NOT EXISTS session_type TEXT NOT NULL DEFAULT 'review'
    CHECK (session_type IN ('review', 'practice'));
