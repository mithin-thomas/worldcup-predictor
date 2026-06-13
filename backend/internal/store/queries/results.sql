-- name: FindMatchByAPIFixtureID :one
SELECT id, stage, home_team_id, away_team_id, kickoff_utc, status, manual_override, api_fixture_id
FROM matches
WHERE api_fixture_id = ?;

-- name: FindMatchByKickoffAndTeams :one
SELECT id, stage, home_team_id, away_team_id, kickoff_utc, status, manual_override, api_fixture_id
FROM matches
WHERE kickoff_utc = ? AND home_team_id = ? AND away_team_id = ?;

-- name: UpdateMatchResult :exec
UPDATE matches
SET status = ?, home_score = ?, away_score = ?, went_to_penalties = ?,
    penalty_winner_team_id = ?, api_fixture_id = ?
WHERE id = ?;

-- name: ListPredictionsForMatch :many
SELECT id, home_score, away_score, penalty_winner_team_id
FROM predictions
WHERE match_id = ?;

-- name: SetPredictionScore :exec
UPDATE predictions SET points = ?, penalty_bonus = ? WHERE id = ?;
