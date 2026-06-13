-- name: UpsertMatch :execresult
INSERT INTO matches (
    api_fixture_id, stage, round, home_team_id, away_team_id,
    kickoff_utc, status, home_score, away_score, went_to_penalties, penalty_winner_team_id
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON DUPLICATE KEY UPDATE
    stage                  = IF(manual_override = 1, stage, VALUES(stage)),
    round                  = IF(manual_override = 1, round, VALUES(round)),
    home_team_id           = IF(manual_override = 1, home_team_id, VALUES(home_team_id)),
    away_team_id           = IF(manual_override = 1, away_team_id, VALUES(away_team_id)),
    kickoff_utc            = IF(manual_override = 1, kickoff_utc, VALUES(kickoff_utc)),
    status                 = IF(manual_override = 1, status, VALUES(status)),
    home_score             = IF(manual_override = 1, home_score, VALUES(home_score)),
    away_score             = IF(manual_override = 1, away_score, VALUES(away_score)),
    went_to_penalties      = IF(manual_override = 1, went_to_penalties, VALUES(went_to_penalties)),
    penalty_winner_team_id = IF(manual_override = 1, penalty_winner_team_id, VALUES(penalty_winner_team_id));

-- name: ListMatchesWithTeams :many
SELECT
    m.id, m.api_fixture_id, m.stage, m.round,
    m.kickoff_utc, m.status, m.home_score, m.away_score,
    m.went_to_penalties, m.penalty_winner_team_id, m.manual_override,
    ht.id AS home_id, ht.name AS home_name, ht.code AS home_code, ht.logo_url AS home_logo,
    at.id AS away_id, at.name AS away_name, at.code AS away_code, at.logo_url AS away_logo
FROM matches m
JOIN teams ht ON ht.id = m.home_team_id
JOIN teams at ON at.id = m.away_team_id
ORDER BY m.kickoff_utc;
