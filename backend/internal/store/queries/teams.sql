-- name: UpsertTeam :exec
INSERT INTO teams (source_id, name, code, group_letter, is_placeholder)
VALUES (?, ?, ?, ?, ?)
ON DUPLICATE KEY UPDATE
    name = VALUES(name), code = VALUES(code),
    group_letter = VALUES(group_letter), is_placeholder = VALUES(is_placeholder);

-- name: GetTeamIDBySourceID :one
SELECT id FROM teams WHERE source_id = ?;
