-- name: ListMatchesForAdmin :many
SELECT m.id, m.match_number, m.stage, m.round,
       m.home_team_id, ht.name AS home_team, ht.code AS home_code,
       m.away_team_id, at.name AS away_team, at.code AS away_code,
       m.kickoff_utc, m.status, m.home_score, m.away_score,
       m.went_to_penalties, m.penalty_winner_team_id, m.manual_override
FROM matches m
LEFT JOIN teams ht ON ht.id = m.home_team_id
LEFT JOIN teams at ON at.id = m.away_team_id
ORDER BY m.kickoff_utc ASC, m.id ASC;

-- name: CreateMatchAdmin :execlastid
INSERT INTO matches
  (source_id, match_number, stage, round, group_letter, match_label,
   home_team_id, away_team_id, kickoff_utc, status, manual_override)
VALUES
  ((SELECT COALESCE(MAX(source_id),0)+1 FROM matches AS m2),
   ?, ?, ?, '', '', ?, ?, ?, 'scheduled', 1);

-- name: UpdateMatchDetailAdmin :exec
UPDATE matches
SET home_team_id = ?, away_team_id = ?, kickoff_utc = ?, stage = ?, round = ?, manual_override = 1
WHERE id = ?;

-- name: DeleteMatchAdmin :execrows
DELETE FROM matches WHERE id = ?;

-- name: MatchExists :one
SELECT COUNT(*) FROM matches WHERE id = ?;

-- name: ListUsersAdmin :many
SELECT id, email, name, avatar_url, role FROM users ORDER BY name ASC, email ASC;

-- name: CountAdmins :one
SELECT COUNT(*) FROM users WHERE role = 'admin';

-- name: GetUserRole :one
SELECT role FROM users WHERE id = ?;

-- name: SetMatchManualOverride :exec
UPDATE matches SET manual_override = 1 WHERE id = ?;
