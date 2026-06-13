ALTER TABLE matches
    DROP KEY uq_matches_api_fixture_id,
    DROP COLUMN api_fixture_id;
