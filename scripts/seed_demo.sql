-- scripts/seed_demo.sql — DEMO/TEST data for SayScore (NOT for production).
--
-- Populates: 5 dummy teammates + renjith (user 1), a completed "last week"
-- (IST Mon 1 Jun – Sun 7 Jun 2026) of finished matches with predictions where
-- renjith is the sole weekly winner, a "week before" (25–31 May) with two
-- co-winners marked PAID, plus predictions on the existing current-week finals
-- so the live weekly + overall leaderboards and the Hall of Fame all show data.
--
-- Idempotent: it deletes its own demo rows first, so it can be re-run safely.
-- Apply:  docker exec -i -e MYSQL_PWD=wcp sayscore-mysql-1 mysql -uwcp wcp < scripts/seed_demo.sql
--
-- Points are pre-materialized to match internal/scoring (5 = exact, 3 = correct
-- result, 0 = wrong; group stage so penalty_bonus = 0). Leaderboards SUM these.

SET @W_LAST   = DATE '2026-06-01';  -- IST Monday of "last week"
SET @W_BEFORE = DATE '2026-05-25';  -- IST Monday of the "week before"

START TRANSACTION;

-- ---- Clean up any prior run of this demo seed ------------------------------
DELETE FROM predictions WHERE user_id IN (2,3,4,5,6);
DELETE FROM predictions
  WHERE match_id IN (SELECT id FROM matches WHERE source_id BETWEEN 9001 AND 9008);
-- renjith's demo current-week predictions (his original m2 & m19 are preserved)
DELETE FROM predictions WHERE user_id = 1 AND match_id IN (7,8,13,14,20);
DELETE FROM weekly_results WHERE week_start IN (@W_LAST, @W_BEFORE);
DELETE FROM matches WHERE source_id BETWEEN 9001 AND 9008;
DELETE FROM users WHERE id IN (2,3,4,5,6);

-- ---- Users -----------------------------------------------------------------
UPDATE users
   SET name = 'Renjith Raj',
       avatar_url = 'https://api.dicebear.com/9.x/initials/svg?seed=Renjith%20Raj'
 WHERE id = 1;

INSERT INTO users (id, email, name, avatar_url, role) VALUES
  (2, 'aisha@sayonetech.com',  'Aisha Khan',  'https://api.dicebear.com/9.x/initials/svg?seed=Aisha%20Khan',  'user'),
  (3, 'dev@sayonetech.com',    'Dev Menon',   'https://api.dicebear.com/9.x/initials/svg?seed=Dev%20Menon',   'user'),
  (4, 'priya@sayonetech.com',  'Priya Nair',  'https://api.dicebear.com/9.x/initials/svg?seed=Priya%20Nair',  'user'),
  (5, 'arjun@sayonetech.com',  'Arjun Pillai','https://api.dicebear.com/9.x/initials/svg?seed=Arjun%20Pillai','user'),
  (6, 'sara@sayonetech.com',   'Sara Thomas', 'https://api.dicebear.com/9.x/initials/svg?seed=Sara%20Thomas', 'user');

-- ---- Matches: LAST WEEK (1–7 Jun IST), all final, group stage --------------
-- kickoff_utc chosen so IST (+5:30) lands inside Mon 1 Jun – Sun 7 Jun.
INSERT INTO matches
  (source_id, match_number, stage, round, group_letter, match_label,
   home_team_id, away_team_id, kickoff_utc, status, home_score, away_score,
   went_to_penalties, manual_override) VALUES
  (9001, 901, 'group', 'Group Stage', '', '', 3,  4,  '2026-06-02 14:00:00', 'final', 2, 0, 0, 0), -- KOR 2-0 CZE
  (9002, 902, 'group', 'Group Stage', '', '', 5,  6,  '2026-06-03 14:00:00', 'final', 1, 1, 0, 0), -- CAN 1-1 BIH
  (9003, 903, 'group', 'Group Stage', '', '', 9,  10, '2026-06-04 14:00:00', 'final', 3, 1, 0, 0), -- BRA 3-1 MAR
  (9004, 904, 'group', 'Group Stage', '', '', 13, 14, '2026-06-05 14:00:00', 'final', 0, 0, 0, 0), -- USA 0-0 PAR
  (9005, 905, 'group', 'Group Stage', '', '', 15, 16, '2026-06-06 14:00:00', 'final', 2, 2, 0, 0); -- AUS 2-2 TUR

-- ---- Matches: WEEK BEFORE (25–31 May IST), all final ------------------------
INSERT INTO matches
  (source_id, match_number, stage, round, group_letter, match_label,
   home_team_id, away_team_id, kickoff_utc, status, home_score, away_score,
   went_to_penalties, manual_override) VALUES
  (9006, 906, 'group', 'Group Stage', '', '', 7,  8,  '2026-05-27 14:00:00', 'final', 1, 2, 0, 0), -- QAT 1-2 SUI
  (9007, 907, 'group', 'Group Stage', '', '', 11, 12, '2026-05-28 14:00:00', 'final', 0, 0, 0, 0), -- HAI 0-0 SCO
  (9008, 908, 'group', 'Group Stage', '', '', 9,  13, '2026-05-29 14:00:00', 'final', 2, 1, 0, 0); -- BRA 2-1 USA

-- ---- Predictions: LAST WEEK (renjith totals 21 -> sole winner) --------------
-- 9001 KOR2-0 | 9002 CAN1-1 | 9003 BRA3-1 | 9004 USA0-0 | 9005 AUS2-2
INSERT INTO predictions (user_id, match_id, home_score, away_score, points, penalty_bonus) VALUES
  -- Renjith (1): 5+5+3+5+3 = 21
  (1,(SELECT id FROM matches WHERE source_id=9001),2,0,5,0),
  (1,(SELECT id FROM matches WHERE source_id=9002),1,1,5,0),
  (1,(SELECT id FROM matches WHERE source_id=9003),2,1,3,0),
  (1,(SELECT id FROM matches WHERE source_id=9004),0,0,5,0),
  (1,(SELECT id FROM matches WHERE source_id=9005),1,1,3,0),
  -- Aisha (2): 5+0+5+0+5 = 15
  (2,(SELECT id FROM matches WHERE source_id=9001),2,0,5,0),
  (2,(SELECT id FROM matches WHERE source_id=9002),0,2,0,0),
  (2,(SELECT id FROM matches WHERE source_id=9003),3,1,5,0),
  (2,(SELECT id FROM matches WHERE source_id=9004),1,0,0,0),
  (2,(SELECT id FROM matches WHERE source_id=9005),2,2,5,0),
  -- Dev (3): 3+5+0+5+3 = 16
  (3,(SELECT id FROM matches WHERE source_id=9001),1,0,3,0),
  (3,(SELECT id FROM matches WHERE source_id=9002),1,1,5,0),
  (3,(SELECT id FROM matches WHERE source_id=9003),0,1,0,0),
  (3,(SELECT id FROM matches WHERE source_id=9004),0,0,5,0),
  (3,(SELECT id FROM matches WHERE source_id=9005),0,0,3,0),
  -- Priya (4): 0+3+5+5+3 = 16
  (4,(SELECT id FROM matches WHERE source_id=9001),0,1,0,0),
  (4,(SELECT id FROM matches WHERE source_id=9002),2,2,3,0),
  (4,(SELECT id FROM matches WHERE source_id=9003),3,1,5,0),
  (4,(SELECT id FROM matches WHERE source_id=9004),0,0,5,0),
  (4,(SELECT id FROM matches WHERE source_id=9005),1,1,3,0),
  -- Arjun (5): 3+5+3+3+0 = 14
  (5,(SELECT id FROM matches WHERE source_id=9001),2,1,3,0),
  (5,(SELECT id FROM matches WHERE source_id=9002),1,1,5,0),
  (5,(SELECT id FROM matches WHERE source_id=9003),1,0,3,0),
  (5,(SELECT id FROM matches WHERE source_id=9004),1,1,3,0),
  (5,(SELECT id FROM matches WHERE source_id=9005),2,0,0,0),
  -- Sara (6): 3+3+3+0+5 = 14
  (6,(SELECT id FROM matches WHERE source_id=9001),3,0,3,0),
  (6,(SELECT id FROM matches WHERE source_id=9002),0,0,3,0),
  (6,(SELECT id FROM matches WHERE source_id=9003),2,1,3,0),
  (6,(SELECT id FROM matches WHERE source_id=9004),0,1,0,0),
  (6,(SELECT id FROM matches WHERE source_id=9005),2,2,5,0);

-- ---- Predictions: WEEK BEFORE (Aisha & Dev tie at 15 -> co-winners) ---------
-- 9006 QAT1-2 | 9007 HAI0-0 | 9008 BRA2-1
INSERT INTO predictions (user_id, match_id, home_score, away_score, points, penalty_bonus) VALUES
  -- Renjith (1): 3+3+3 = 9
  (1,(SELECT id FROM matches WHERE source_id=9006),0,1,3,0),
  (1,(SELECT id FROM matches WHERE source_id=9007),1,1,3,0),
  (1,(SELECT id FROM matches WHERE source_id=9008),2,0,3,0),
  -- Aisha (2): 5+5+5 = 15  (perfect week)
  (2,(SELECT id FROM matches WHERE source_id=9006),1,2,5,0),
  (2,(SELECT id FROM matches WHERE source_id=9007),0,0,5,0),
  (2,(SELECT id FROM matches WHERE source_id=9008),2,1,5,0),
  -- Dev (3): 5+5+5 = 15  (perfect week -> co-winner)
  (3,(SELECT id FROM matches WHERE source_id=9006),1,2,5,0),
  (3,(SELECT id FROM matches WHERE source_id=9007),0,0,5,0),
  (3,(SELECT id FROM matches WHERE source_id=9008),2,1,5,0),
  -- Priya (4): 0+5+0 = 5
  (4,(SELECT id FROM matches WHERE source_id=9006),2,1,0,0),
  (4,(SELECT id FROM matches WHERE source_id=9007),0,0,5,0),
  (4,(SELECT id FROM matches WHERE source_id=9008),1,1,0,0),
  -- Arjun (5): 5+0+5 = 10
  (5,(SELECT id FROM matches WHERE source_id=9006),1,2,5,0),
  (5,(SELECT id FROM matches WHERE source_id=9007),1,0,0,0),
  (5,(SELECT id FROM matches WHERE source_id=9008),2,1,5,0),
  -- Sara (6): 3+5+0 = 8
  (6,(SELECT id FROM matches WHERE source_id=9006),0,2,3,0),
  (6,(SELECT id FROM matches WHERE source_id=9007),0,0,5,0),
  (6,(SELECT id FROM matches WHERE source_id=9008),0,0,0,0);

-- ---- Predictions: CURRENT WEEK (existing finals; populate live boards) ------
-- Actuals: m2 KOR2-1 | m7 CAN1-1 | m8 QAT1-1 | m13 BRA1-1 | m14 HAI0-1 |
--          m19 USA4-1 | m20 AUS2-0   (renjith already has m2=3, m19=5)
INSERT INTO predictions (user_id, match_id, home_score, away_score, points, penalty_bonus) VALUES
  -- Renjith (1) adds 5+5+5+5+5 = 25 -> current-week total 33
  (1, 7, 1,1,5,0), (1, 8, 1,1,5,0), (1,13, 1,1,5,0), (1,14, 0,1,5,0), (1,20, 2,0,5,0),
  -- Aisha (2): 5+5+3+0+5+3+3 = 24
  (2, 2, 2,1,5,0), (2, 7, 1,1,5,0), (2, 8, 0,0,3,0), (2,13, 2,1,0,0), (2,14, 0,1,5,0), (2,19, 3,1,3,0), (2,20, 1,0,3,0),
  -- Dev (3): 3+5+5+3+3+5+5 = 29
  (3, 2, 1,0,3,0), (3, 7, 1,1,5,0), (3, 8, 1,1,5,0), (3,13, 0,0,3,0), (3,14, 1,2,3,0), (3,19, 4,1,5,0), (3,20, 2,0,5,0),
  -- Priya (4): 5+3+3+5+5+3+0 = 24
  (4, 2, 2,1,5,0), (4, 7, 0,0,3,0), (4, 8, 2,2,3,0), (4,13, 1,1,5,0), (4,14, 0,1,5,0), (4,19, 2,0,3,0), (4,20, 1,1,0,0),
  -- Arjun (5): 5+0+5+5+3+5+5 = 28
  (5, 2, 2,1,5,0), (5, 7, 2,1,0,0), (5, 8, 1,1,5,0), (5,13, 1,1,5,0), (5,14, 0,2,3,0), (5,19, 4,1,5,0), (5,20, 2,0,5,0),
  -- Sara (6): 0+5+0+3+5+3+3 = 22
  (6, 2, 1,1,0,0), (6, 7, 1,1,5,0), (6, 8, 0,1,0,0), (6,13, 2,2,3,0), (6,14, 0,1,5,0), (6,19, 1,0,3,0), (6,20, 3,1,3,0);

-- ---- weekly_results: LAST WEEK -> renjith sole winner, UNPAID ---------------
INSERT INTO weekly_results (user_id, week_start, points, is_winner, prize_paid, paid_at) VALUES
  (1, @W_LAST, 21, 1, 0, NULL),  -- Renjith — winner (test "Mark paid" here)
  (3, @W_LAST, 16, 0, 0, NULL),
  (4, @W_LAST, 16, 0, 0, NULL),
  (2, @W_LAST, 15, 0, 0, NULL),
  (5, @W_LAST, 14, 0, 0, NULL),
  (6, @W_LAST, 14, 0, 0, NULL);

-- ---- weekly_results: WEEK BEFORE -> Aisha & Dev co-winners, PAID ------------
INSERT INTO weekly_results (user_id, week_start, points, is_winner, prize_paid, paid_at) VALUES
  (2, @W_BEFORE, 15, 1, 1, '2026-05-26 10:00:00'),  -- Aisha — co-winner, paid
  (3, @W_BEFORE, 15, 1, 1, '2026-05-26 10:00:00'),  -- Dev   — co-winner, paid
  (5, @W_BEFORE, 10, 0, 0, NULL),
  (1, @W_BEFORE,  9, 0, 0, NULL),
  (6, @W_BEFORE,  8, 0, 0, NULL),
  (4, @W_BEFORE,  5, 0, 0, NULL);

COMMIT;
