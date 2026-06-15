-- name: GetSetting :one
SELECT value FROM settings WHERE `key` = ?;

-- name: UpsertSetting :exec
INSERT INTO settings (`key`, `value`) VALUES (?, ?)
ON DUPLICATE KEY UPDATE value = VALUES(value);

-- name: ListSettings :many
SELECT `key`, value FROM settings;
