ALTER TABLE weekly_results
  ADD COLUMN prize_paid BOOL      NOT NULL DEFAULT 0 AFTER is_winner,
  ADD COLUMN paid_at    DATETIME  NULL              AFTER prize_paid;
