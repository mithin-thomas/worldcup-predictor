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
