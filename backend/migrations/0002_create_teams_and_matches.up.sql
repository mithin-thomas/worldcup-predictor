CREATE TABLE venues (
    id             BIGINT       NOT NULL AUTO_INCREMENT,
    source_id      BIGINT       NOT NULL,
    city_name      VARCHAR(128) NOT NULL,
    country        VARCHAR(64)  NOT NULL DEFAULT '',
    venue_name     VARCHAR(128) NOT NULL DEFAULT '',
    region_cluster VARCHAR(64)  NOT NULL DEFAULT '',
    airport_code   VARCHAR(8)   NOT NULL DEFAULT '',
    PRIMARY KEY (id),
    UNIQUE KEY uq_venues_source_id (source_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE teams (
    id             BIGINT       NOT NULL AUTO_INCREMENT,
    source_id      BIGINT       NOT NULL,
    name           VARCHAR(128) NOT NULL,
    code           VARCHAR(8)   NOT NULL DEFAULT '',
    group_letter   VARCHAR(4)   NOT NULL DEFAULT '',
    is_placeholder BOOL         NOT NULL DEFAULT 0,
    PRIMARY KEY (id),
    UNIQUE KEY uq_teams_source_id (source_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE matches (
    id                     BIGINT       NOT NULL AUTO_INCREMENT,
    source_id              BIGINT       NOT NULL,
    match_number           INT          NOT NULL DEFAULT 0,
    stage                  ENUM('group','knockout') NOT NULL DEFAULT 'group',
    round                  VARCHAR(64)  NOT NULL DEFAULT '',
    group_letter           VARCHAR(4)   NOT NULL DEFAULT '',
    match_label            VARCHAR(64)  NOT NULL DEFAULT '',
    home_team_id           BIGINT       NULL,
    away_team_id           BIGINT       NULL,
    venue_id               BIGINT       NULL,
    kickoff_utc            DATETIME     NOT NULL,
    status                 ENUM('scheduled','live','final') NOT NULL DEFAULT 'scheduled',
    home_score             INT          NULL,
    away_score             INT          NULL,
    went_to_penalties      BOOL         NOT NULL DEFAULT 0,
    penalty_winner_team_id BIGINT       NULL,
    manual_override        BOOL         NOT NULL DEFAULT 0,
    updated_at             TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_matches_source_id (source_id),
    KEY idx_matches_kickoff (kickoff_utc),
    CONSTRAINT fk_matches_home  FOREIGN KEY (home_team_id) REFERENCES teams (id),
    CONSTRAINT fk_matches_away  FOREIGN KEY (away_team_id) REFERENCES teams (id),
    CONSTRAINT fk_matches_venue FOREIGN KEY (venue_id)     REFERENCES venues (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
