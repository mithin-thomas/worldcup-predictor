CREATE TABLE players (
  id        BIGINT       NOT NULL AUTO_INCREMENT,
  source_id BIGINT       NOT NULL,
  team_id   BIGINT       NOT NULL,
  name      VARCHAR(128) NOT NULL,
  position  VARCHAR(32)  NOT NULL DEFAULT '',
  PRIMARY KEY (id),
  UNIQUE KEY uq_players_source (source_id),
  KEY idx_players_team (team_id),
  KEY idx_players_name (name),
  CONSTRAINT fk_players_team FOREIGN KEY (team_id) REFERENCES teams (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
