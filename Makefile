.PHONY: up down logs migrate-up migrate-down sqlc test lint

up:
	docker compose -f deploy/docker-compose.yml up -d

down:
	docker compose -f deploy/docker-compose.yml down

logs:
	docker compose -f deploy/docker-compose.yml logs -f

# Requires golang-migrate CLI: https://github.com/golang-migrate/migrate
MIGRATE_DSN=mysql://$(DB_USER):$(DB_PASSWORD)@tcp($(DB_HOST):$(DB_PORT))/$(DB_NAME)
migrate-up:
	migrate -path backend/migrations -database "$(MIGRATE_DSN)" up

migrate-down:
	migrate -path backend/migrations -database "$(MIGRATE_DSN)" down 1

sqlc:
	cd backend && sqlc generate

test:
	cd backend && go test ./...

lint:
	cd backend && go vet ./...
