CREATE TABLE bonus_predictions (
  id         BIGINT NOT NULL AUTO_INCREMENT,
  user_id    BIGINT NOT NULL,
  category   ENUM('winner','runner_up','golden_ball','golden_boot','golden_glove','young_player','fair_play') NOT NULL,
  ref_id     BIGINT NOT NULL,
  points     INT    NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_bonus_user_cat (user_id, category),
  KEY idx_bonus_user (user_id),
  CONSTRAINT fk_bonus_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE bonus_results (
  category   ENUM('winner','runner_up','golden_ball','golden_boot','golden_glove','young_player','fair_play') NOT NULL,
  ref_id     BIGINT NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (category)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
