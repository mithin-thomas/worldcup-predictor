ALTER TABLE matches
    ADD COLUMN api_fixture_id BIGINT NULL AFTER source_id,
    ADD UNIQUE KEY uq_matches_api_fixture_id (api_fixture_id);
