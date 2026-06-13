# SayScore — developer commands. Run `make` or `make help` for the list.

# Named compose project so all containers/volumes are grouped under "sayscore".
COMPOSE := docker compose -p sayscore -f deploy/docker-compose.yml

# Load backend/.env (if present) so DB_* / secrets are available to recipes.
# Each recipe sources it; values already in the environment win.
ENVFILE := backend/.env
define load_env
set -a; [ -f $(ENVFILE) ] && . ./$(ENVFILE); set +a
endef

# DB defaults (used only if not set in backend/.env)
DB_HOST ?= 127.0.0.1
DB_PORT ?= 3306
DB_USER ?= wcp
DB_PASSWORD ?= wcp
DB_NAME ?= wcp

.DEFAULT_GOAL := help
.PHONY: help up up-d down logs ps adminer migrate-up migrate-down migrate-new \
        sqlc run dev seed-fixtures test test-frontend lint fmt tidy \
        build hooks hooks-tools

help: ## Show this help
	@grep -hE '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) \
	  | awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

## ---- Docker / local stack ----
up: ## Build + run the whole stack in the FOREGROUND with live logs (Ctrl-C to stop) → :8080
	@echo "Starting → app: http://localhost:8080 · docs: http://localhost:8000/docs · adminer: http://localhost:8081"
	@set -a; [ -f frontend/.env ] && . ./frontend/.env; set +a; \
	$(COMPOSE) up --build

up-d: ## Same as up, but detached/background (use `make logs` to follow)
	@set -a; [ -f frontend/.env ] && . ./frontend/.env; set +a; \
	$(COMPOSE) up -d --build

down: ## Stop and remove the local stack
	$(COMPOSE) down

logs: ## Tail stack logs
	$(COMPOSE) logs -f

ps: ## Show stack containers
	$(COMPOSE) ps

adminer: ## Print the Adminer URL
	@echo "Adminer: http://localhost:8081  (server: mysql, user: $(DB_USER), db: $(DB_NAME))"

## ---- Database migrations (golang-migrate) ----
migrate-up: ## Apply all migrations
	@$(load_env); \
	migrate -path backend/migrations \
	  -database "mysql://$$DB_USER:$$DB_PASSWORD@tcp($$DB_HOST:$$DB_PORT)/$$DB_NAME" up

migrate-down: ## Roll back the last migration
	@$(load_env); \
	migrate -path backend/migrations \
	  -database "mysql://$$DB_USER:$$DB_PASSWORD@tcp($$DB_HOST:$$DB_PORT)/$$DB_NAME" down 1

migrate-new: ## Create a new migration pair: make migrate-new name=add_widgets
	@test -n "$(name)" || { echo "usage: make migrate-new name=<snake_case>"; exit 1; }
	migrate create -ext sql -dir backend/migrations -seq $(name)

## ---- Code generation ----
sqlc: ## Regenerate type-safe DB code from SQL
	cd backend && sqlc generate

## ---- Run / develop ----
run: ## Run the backend (loads backend/.env)
	cd backend && go run ./cmd/server

dev: ## Run the Vite frontend dev server
	cd frontend && pnpm dev

seed-fixtures: ## Seed teams, venues, and fixtures from the committed CSV dataset (data/)
	cd backend && SEED_DATA_DIR=../data go run ./cmd/seedfixtures

## ---- Quality ----
test: ## Backend tests
	cd backend && go test ./... -count=1

test-frontend: ## Frontend tests (vitest, if configured)
	cd frontend && pnpm test --run || true

lint: ## go vet + golangci-lint (if installed)
	cd backend && go vet ./... && (command -v golangci-lint >/dev/null 2>&1 && golangci-lint run || echo "golangci-lint not installed (make hooks-tools)")

fmt: ## Format Go + frontend
	cd backend && gofmt -w .
	cd frontend && pnpm exec prettier --write "src/**/*.{ts,tsx,css}" 2>/dev/null || true

tidy: ## go mod tidy
	cd backend && go mod tidy

build: ## Build backend binary + frontend bundle
	cd backend && go build ./...
	cd frontend && pnpm build

## ---- Git hooks (Lefthook) ----
hooks: ## Install git hooks (requires lefthook; see hooks-tools)
	lefthook install

hooks-tools: ## Install dev tooling for hooks (lefthook, golangci-lint)
	go install github.com/evilmartians/lefthook@latest
	go install github.com/golangci/golangci-lint/cmd/golangci-lint@latest
	@echo "Installed to $$(go env GOPATH)/bin — ensure it's on your PATH, then run: make hooks"
