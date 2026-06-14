-- The INNER JOIN from predictions is deliberate: only users with >=1 prediction
-- in the window appear; zero-prediction users are intentionally excluded per the
-- approved M6 design. Do NOT change to a LEFT JOIN.
-- name: WeeklyLeaderboard :many
SELECT u.id AS user_id, u.name, u.avatar_url,
       CAST(COALESCE(SUM(COALESCE(p.points,0) + COALESCE(p.penalty_bonus,0)), 0) AS SIGNED) AS points,
       CAST(COALESCE(SUM(CASE WHEN p.points = 5 THEN 1 ELSE 0 END), 0) AS SIGNED) AS exact_count,
       CAST(COALESCE(SUM(CASE WHEN p.points = 3 THEN 1 ELSE 0 END), 0) AS SIGNED) AS correct_count
FROM predictions p
JOIN users u ON u.id = p.user_id
JOIN matches m ON m.id = p.match_id
WHERE m.kickoff_utc >= ? AND m.kickoff_utc < ?
GROUP BY u.id, u.name, u.avatar_url
ORDER BY points DESC, exact_count DESC, correct_count DESC, u.id ASC;

-- The INNER JOIN from predictions is deliberate: only users with >=1 prediction
-- appear; zero-prediction users are intentionally excluded per the approved M6
-- design. Do NOT change to a LEFT JOIN.
-- name: OverallLeaderboard :many
SELECT u.id AS user_id, u.name, u.avatar_url,
       CAST(COALESCE(SUM(COALESCE(p.points,0) + COALESCE(p.penalty_bonus,0)), 0) AS SIGNED) AS points,
       CAST(COALESCE(SUM(CASE WHEN p.points = 5 THEN 1 ELSE 0 END), 0) AS SIGNED) AS exact_count,
       CAST(COALESCE(SUM(CASE WHEN p.points = 3 THEN 1 ELSE 0 END), 0) AS SIGNED) AS correct_count
FROM predictions p
JOIN users u ON u.id = p.user_id
GROUP BY u.id, u.name, u.avatar_url
ORDER BY points DESC, exact_count DESC, correct_count DESC, u.id ASC;

-- name: UpsertWeeklyResult :exec
INSERT INTO weekly_results (user_id, week_start, points, is_winner)
VALUES (?, ?, ?, ?)
ON DUPLICATE KEY UPDATE points = VALUES(points), is_winner = VALUES(is_winner);

-- name: ListWeeklyResults :many
SELECT user_id, points, is_winner
FROM weekly_results
WHERE week_start = ?;

-- name: ListWinners :many
SELECT w.week_start, w.user_id, u.name, u.avatar_url, w.points, w.prize_paid, w.paid_at
FROM weekly_results w
JOIN users u ON u.id = w.user_id
WHERE w.is_winner = 1
ORDER BY w.week_start DESC, w.points DESC, u.id ASC;

-- name: MarkWinnerPaid :execrows
UPDATE weekly_results
SET prize_paid = ?, paid_at = ?
WHERE week_start = ? AND user_id = ? AND is_winner = 1;
