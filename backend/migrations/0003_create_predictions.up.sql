CREATE TABLE predictions (
    id                     BIGINT    NOT NULL AUTO_INCREMENT,
    user_id                BIGINT    NOT NULL,
    match_id               BIGINT    NOT NULL,
    home_score             INT       NOT NULL,
    away_score             INT       NOT NULL,
    penalty_winner_team_id BIGINT    NULL,
    points                 INT       NULL,
    penalty_bonus          INT       NULL,
    created_at             TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at             TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_pred_user_match (user_id, match_id),
    KEY idx_pred_match (match_id),
    CONSTRAINT fk_pred_user   FOREIGN KEY (user_id)  REFERENCES users (id)   ON DELETE CASCADE,
    CONSTRAINT fk_pred_match  FOREIGN KEY (match_id) REFERENCES matches (id) ON DELETE CASCADE,
    CONSTRAINT fk_pred_penwin FOREIGN KEY (penalty_winner_team_id) REFERENCES teams (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
