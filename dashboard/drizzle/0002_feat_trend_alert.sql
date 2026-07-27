-- Feature 6: Confidence-Weighted Alerting Tied to Trend Direction
-- Stores the structured trend alert computed at scan completion.
-- NULL means the score did not exceed the threshold in the rolling window.
ALTER TABLE "scans" ADD COLUMN "trend_alert" jsonb DEFAULT 'null'::jsonb;
