-- name: UpsertBonusPrediction :exec
INSERT INTO bonus_predictions (user_id, category, ref_id)
VALUES (?, ?, ?)
ON DUPLICATE KEY UPDATE ref_id = VALUES(ref_id);

-- name: ListBonusPredictionsForUser :many
SELECT category, ref_id, points FROM bonus_predictions WHERE user_id = ?;

-- name: UpsertBonusResult :exec
INSERT INTO bonus_results (category, ref_id)
VALUES (?, ?)
ON DUPLICATE KEY UPDATE ref_id = VALUES(ref_id);

-- name: ListBonusResults :many
SELECT category, ref_id FROM bonus_results;

-- name: ListAllBonusPredictions :many
SELECT id, category, ref_id FROM bonus_predictions;

-- name: SetBonusPredictionPoints :exec
UPDATE bonus_predictions SET points = ? WHERE id = ?;
