-- name: UpsertVenue :exec
INSERT INTO venues (source_id, city_name, country, venue_name, region_cluster, airport_code)
VALUES (?, ?, ?, ?, ?, ?)
ON DUPLICATE KEY UPDATE
    city_name = VALUES(city_name), country = VALUES(country),
    venue_name = VALUES(venue_name), region_cluster = VALUES(region_cluster),
    airport_code = VALUES(airport_code);

-- name: GetVenueIDBySourceID :one
SELECT id FROM venues WHERE source_id = ?;
