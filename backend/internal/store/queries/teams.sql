-- name: UpsertTeam :execresult
INSERT INTO teams (api_team_id, name, code, logo_url)
VALUES (?, ?, ?, ?)
ON DUPLICATE KEY UPDATE
    name = VALUES(name),
    code = VALUES(code),
    logo_url = VALUES(logo_url);

-- name: GetTeamByAPIID :one
SELECT id, api_team_id, name, code, logo_url
FROM teams WHERE api_team_id = ?;

-- name: ListTeams :many
SELECT id, api_team_id, name, code, logo_url
FROM teams ORDER BY name;
