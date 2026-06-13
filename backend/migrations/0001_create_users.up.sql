CREATE TABLE users (
    id         BIGINT       NOT NULL AUTO_INCREMENT,
    email      VARCHAR(320) NOT NULL,
    name       VARCHAR(255) NOT NULL DEFAULT '',
    avatar_url VARCHAR(1024) NOT NULL DEFAULT '',
    role       ENUM('user','admin') NOT NULL DEFAULT 'user',
    created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
