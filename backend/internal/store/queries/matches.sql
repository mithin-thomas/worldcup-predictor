-- name: UpsertMatch :exec
INSERT INTO matches (
    source_id, match_number, stage, round, group_letter, match_label,
    home_team_id, away_team_id, venue_id, kickoff_utc, status
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON DUPLICATE KEY UPDATE
    match_number = IF(manual_override=1, match_number, VALUES(match_number)),
    stage        = IF(manual_override=1, stage, VALUES(stage)),
    round        = IF(manual_override=1, round, VALUES(round)),
    group_letter = IF(manual_override=1, group_letter, VALUES(group_letter)),
    match_label  = IF(manual_override=1, match_label, VALUES(match_label)),
    home_team_id = IF(manual_override=1, home_team_id, VALUES(home_team_id)),
    away_team_id = IF(manual_override=1, away_team_id, VALUES(away_team_id)),
    venue_id     = IF(manual_override=1, venue_id, VALUES(venue_id)),
    kickoff_utc  = IF(manual_override=1, kickoff_utc, VALUES(kickoff_utc)),
    status       = IF(manual_override=1, status, VALUES(status));

-- name: ListMatchesWithTeams :many
SELECT
    m.id, m.source_id, m.match_number, m.stage, m.round, m.group_letter, m.match_label,
    m.kickoff_utc, m.status, m.home_score, m.away_score,
    m.went_to_penalties, m.penalty_winner_team_id, m.manual_override,
    m.home_team_id, ht.name AS home_name, ht.code AS home_code,
    m.away_team_id, at.name AS away_name, at.code AS away_code,
    m.venue_id, v.venue_name AS venue_name, v.city_name AS venue_city, v.country AS venue_country
FROM matches m
LEFT JOIN teams ht ON ht.id = m.home_team_id
LEFT JOIN teams at ON at.id = m.away_team_id
LEFT JOIN venues v ON v.id = m.venue_id
ORDER BY m.kickoff_utc, m.match_number;

-- name: GetMatchByID :one
SELECT id, stage, home_team_id, away_team_id, kickoff_utc, status, manual_override, api_fixture_id
FROM matches
WHERE id = ?;

-- name: ListFinalMatches :many
SELECT id, stage, home_team_id, away_team_id, home_score, away_score,
       went_to_penalties, penalty_winner_team_id
FROM matches WHERE status = 'final';
