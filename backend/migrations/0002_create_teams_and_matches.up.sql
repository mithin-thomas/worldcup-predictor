CREATE TABLE teams (
    id          BIGINT       NOT NULL AUTO_INCREMENT,
    api_team_id BIGINT       NOT NULL,
    name        VARCHAR(255) NOT NULL,
    code        VARCHAR(16)  NOT NULL DEFAULT '',
    logo_url    VARCHAR(1024) NOT NULL DEFAULT '',
    PRIMARY KEY (id),
    UNIQUE KEY uq_teams_api_team_id (api_team_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE matches (
    id                     BIGINT       NOT NULL AUTO_INCREMENT,
    api_fixture_id         BIGINT       NOT NULL,
    stage                  ENUM('group','knockout') NOT NULL DEFAULT 'group',
    round                  VARCHAR(64)  NOT NULL DEFAULT '',
    home_team_id           BIGINT       NOT NULL,
    away_team_id           BIGINT       NOT NULL,
    kickoff_utc            DATETIME     NOT NULL,
    status                 ENUM('scheduled','live','final') NOT NULL DEFAULT 'scheduled',
    home_score             INT          NULL,
    away_score             INT          NULL,
    went_to_penalties      BOOL         NOT NULL DEFAULT 0,
    penalty_winner_team_id BIGINT       NULL,
    manual_override        BOOL         NOT NULL DEFAULT 0,
    updated_at             TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_matches_api_fixture_id (api_fixture_id),
    KEY idx_matches_kickoff (kickoff_utc),
    CONSTRAINT fk_matches_home FOREIGN KEY (home_team_id) REFERENCES teams (id),
    CONSTRAINT fk_matches_away FOREIGN KEY (away_team_id) REFERENCES teams (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
