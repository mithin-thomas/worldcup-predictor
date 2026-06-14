-- name: UpsertPlayer :exec
INSERT INTO players (source_id, team_id, name, position)
VALUES (?, ?, ?, ?)
ON DUPLICATE KEY UPDATE team_id = VALUES(team_id), name = VALUES(name), position = VALUES(position);

-- name: SearchPlayers :many
SELECT p.id, p.name, p.position, t.code AS team_code
FROM players p JOIN teams t ON t.id = p.team_id
WHERE p.name LIKE CONCAT('%', ?, '%')
ORDER BY p.name ASC
LIMIT 20;

-- name: ListTeamsForPicker :many
SELECT id, name, code FROM teams WHERE is_placeholder = 0 ORDER BY name ASC;

-- name: PlayerExists :one
SELECT COUNT(*) FROM players WHERE id = ?;

-- name: TeamExists :one
SELECT COUNT(*) FROM teams WHERE id = ? AND is_placeholder = 0;
