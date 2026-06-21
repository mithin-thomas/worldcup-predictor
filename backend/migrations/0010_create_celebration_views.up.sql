CREATE TABLE celebration_views (
  user_id  BIGINT    NOT NULL,
  match_id BIGINT    NOT NULL,
  seen_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, match_id),
  CONSTRAINT fk_celview_user  FOREIGN KEY (user_id)  REFERENCES users (id)   ON DELETE CASCADE,
  CONSTRAINT fk_celview_match FOREIGN KEY (match_id) REFERENCES matches (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
