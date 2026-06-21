-- name: ListUnseenFinalMatchesForUser :many
-- All FINAL matches the given user has not yet had a celebration recorded for,
-- newest kickoff first. Win/allowlist filtering happens in Go (celebrationFor).
SELECT m.id                     AS match_id,
       ht.id                    AS home_id,
       ht.code                  AS home_code,
       m.home_score             AS home_score,
       at.id                    AS away_id,
       at.code                  AS away_code,
       m.away_score             AS away_score,
       m.penalty_winner_team_id AS penalty_winner_team_id,
       m.kickoff_utc            AS kickoff_utc
FROM matches m
JOIN teams ht ON ht.id = m.home_team_id
JOIN teams at ON at.id = m.away_team_id
LEFT JOIN celebration_views cv ON cv.match_id = m.id AND cv.user_id = ?
WHERE m.status = 'final' AND cv.match_id IS NULL
ORDER BY m.kickoff_utc DESC;

-- name: MarkCelebrationSeen :exec
INSERT INTO celebration_views (user_id, match_id)
VALUES (?, ?)
ON DUPLICATE KEY UPDATE seen_at = seen_at;
