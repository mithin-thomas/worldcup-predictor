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
