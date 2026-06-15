-- name: UpsertPrediction :exec
INSERT INTO predictions (user_id, match_id, home_score, away_score, penalty_winner_team_id)
VALUES (?, ?, ?, ?, ?)
ON DUPLICATE KEY UPDATE
    home_score             = VALUES(home_score),
    away_score             = VALUES(away_score),
    penalty_winner_team_id = VALUES(penalty_winner_team_id);

-- name: ListPredictionsByUser :many
SELECT match_id, home_score, away_score, penalty_winner_team_id, points, penalty_bonus
FROM predictions
WHERE user_id = ?;

-- name: ListMatchPredictionsWithUsers :many
-- All users' predictions for one match, with the player's name/avatar. Used to
-- reveal others' picks after a match locks at kickoff (privacy, spec §4).
-- Scored rows first (points desc), then alphabetical for not-yet-scored matches.
SELECT
    u.id AS user_id, u.name, u.avatar_url,
    p.home_score, p.away_score, p.penalty_winner_team_id,
    p.points, p.penalty_bonus
FROM predictions p
JOIN users u ON u.id = p.user_id
WHERE p.match_id = ?
ORDER BY (p.points IS NULL), p.points DESC, u.name ASC, u.id ASC;
