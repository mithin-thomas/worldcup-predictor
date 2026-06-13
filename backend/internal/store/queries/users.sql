-- name: GetUserByID :one
SELECT id, email, name, avatar_url, role, created_at
FROM users WHERE id = ?;

-- name: GetUserByEmail :one
SELECT id, email, name, avatar_url, role, created_at
FROM users WHERE email = ?;

-- name: UpsertUser :execresult
INSERT INTO users (email, name, avatar_url, role)
VALUES (?, ?, ?, ?)
ON DUPLICATE KEY UPDATE
    name = VALUES(name),
    avatar_url = VALUES(avatar_url);

-- name: SetUserRole :exec
UPDATE users SET role = ? WHERE id = ?;
