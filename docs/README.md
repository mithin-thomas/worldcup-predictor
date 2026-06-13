# SayScore

Internal, mobile-first web app for SayOne employees to predict FIFA World Cup 2026 match scores, earn points, and compete on weekly and overall leaderboards. (Repository slug: `worldcup-predictor`; product name: **SayScore**.)

- **Backend**: Go 1.22 (chi, sqlc) · **Frontend**: React + TypeScript + Vite (Tailwind, shadcn/ui)
- **Database**: MySQL 8 (RDS in production) · **Auth**: Google Workspace SSO, restricted to `sayonetech.com`
- **Data source**: API-Football (fixtures, results, shootouts) · **Times**: stored UTC, shown IST

Full scope, scoring rules, and the design system are in [`docs/REQUIREMENTS.md`](docs/REQUIREMENTS.md).

---

## Repository layout

```
backend/    Go service (API, scoring engine, scheduled jobs)
frontend/   React SPA
deploy/     docker-compose for local + deploy assets
docs/        REQUIREMENTS.md (spec + design system)
lefthook.yml Pre-commit / pre-push hooks (Go + JS)
Makefile     Common commands
```

The Go module lives **inside `backend/`** (so Go tooling never touches `node_modules`). Module path:

```
github.com/sayonetech/worldcup-predictor/backend
```

---

## Prerequisites

- **Docker** and **Docker Compose v2** (the only hard requirement to run the app)
- For local tooling / pre-commit hooks: **Go 1.22+**, **Node 20+** with **pnpm**, and **Lefthook**
- A **Google OAuth Client ID** (Workspace, web application) and an **API-Football key**

---

## Quick start (Docker)

```bash
# 1. Clone
git clone git@github.com:sayonetech/worldcup-predictor.git
cd worldcup-predictor

# 2. Configure environment
cp .env.example .env
#   then edit .env — set GOOGLE_CLIENT_ID, APIFOOTBALL_KEY, SESSION_SECRET, SEED_ADMIN_EMAILS

# 3. Bring up the stack (MySQL + backend + frontend)
docker compose -f deploy/docker-compose.yml up --build
```

The app is then available at **http://localhost:8080** (frontend/nginx, which proxies `/api` to the backend). MySQL is exposed on `localhost:3306` for inspection with a local client (e.g. MySQL Workbench).

### First-run: migrate and seed fixtures

In a second terminal:

```bash
# Apply database migrations
make migrate-up

# Seed teams + all 104 fixtures from API-Football (one-time)
make seed-fixtures
```

Sign in with a `@sayonetech.com` Google account. Accounts listed in `SEED_ADMIN_EMAILS` are provisioned as admins and can re-sync fixtures, edit matches, and correct results from the Admin tab.

---

## Environment variables

Copy `.env.example` to `.env` and fill in the blanks.

**Backend**

| Variable | Example | Notes |
|---|---|---|
| `APP_ENV` | `development` | |
| `HTTP_PORT` | `8000` | |
| `DB_HOST` / `DB_PORT` | `mysql` / `3306` | `mysql` is the compose service name |
| `DB_USER` / `DB_PASSWORD` / `DB_NAME` | `wcp` / `…` / `wcp` | |
| `SESSION_SECRET` | `<random 32+ bytes>` | signs the session cookie |
| `GOOGLE_CLIENT_ID` | `xxxx.apps.googleusercontent.com` | Workspace web client |
| `ALLOWED_EMAIL_DOMAIN` | `sayonetech.com` | SSO domain gate |
| `SEED_ADMIN_EMAILS` | `you@sayonetech.com` | comma-separated initial admins |
| `APIFOOTBALL_KEY` | `…` | API-Football key |
| `APIFOOTBALL_BASE_URL` | `https://v3.football.api-sports.io` | |
| `RESULTS_CRON` | `0 13 * * *` | daily results ingest, 13:00 IST (configurable) |
| `WEEKLY_CRON` | `30 13 * * 1` | weekly-winner calc, Mondays |
| `BONUS_LOCK_AT` | `2026-06-28T23:59:00+05:30` | tournament bonus lock |
| `TZ` | `Asia/Kolkata` | scheduler timezone |

**Frontend**

| Variable | Example |
|---|---|
| `VITE_GOOGLE_CLIENT_ID` | `xxxx.apps.googleusercontent.com` |
| `VITE_API_BASE_URL` | `/api` |

> Never commit `.env`. Production reads these from your deployment environment / secrets manager, with `DB_*` pointing at RDS.

---

## Common commands (Makefile)

```bash
make up              # docker compose up --build
make down            # stop and remove containers
make logs            # tail all service logs
make migrate-up      # apply DB migrations
make migrate-down    # roll back the last migration
make seed-fixtures   # fetch teams + fixtures from API-Football
make recompute       # force a points recompute
make sqlc            # regenerate type-safe DB code from SQL
make lint            # run backend + frontend linters
make test            # run backend + frontend tests
make hooks           # install Lefthook git hooks
```

---

## Pre-commit hooks

Hooks are managed by **Lefthook** and cover both stacks (see `lefthook.yml`). After cloning:

```bash
make hooks          # or: lefthook install
```

On every commit (staged files only): Go `gofmt` + `go vet` + `golangci-lint` + `sqlc diff`, and frontend `eslint` + `prettier` + `tsc --noEmit`. On push: `go test` and `vitest`. Commit messages are checked against Conventional Commits.

---

## Building with Superpowers

This project is built using the [Superpowers](https://github.com/obra/superpowers) plugin for Claude Code, which enforces brainstorm → plan → TDD execution. `docs/REQUIREMENTS.md` is the captured spec; feed it in rather than re-deriving requirements.

1. **Install the plugin** (in Claude Code):
   ```
   /plugin marketplace add obra/superpowers-marketplace
   /plugin install superpowers@superpowers-marketplace
   /help          # confirm /superpowers:brainstorm, write-plan, execute-plan appear
   ```
2. **Brainstorm against the existing spec** — don't start from scratch; lock the open decisions in §17 of the spec:
   ```
   /superpowers:brainstorm  Use docs/REQUIREMENTS.md as the locked spec for SayScore.
   Don't re-litigate settled choices. Resolve only the open questions in section 17
   (penalty-bonus rule, final tie-break, prediction privacy, deployment target).
   Confirm the Go module path is github.com/sayonetech/worldcup-predictor/backend.
   ```
3. **Write a plan per milestone** (keep them small — one vertical slice each):
   ```
   /superpowers:write-plan  Milestone 1: repo scaffold + Google SSO (sayonetech.com only)
   + users table + /api/me. Backend module in backend/, frontend Vite app in frontend/.
   ```
   Suggested milestone order: (1) scaffold + SSO, (2) fixtures sync from API-Football + IST fixtures list, (3) predictions + server-side kickoff lock, (4) **scoring engine** (pure, exhaustively TDD'd — this is the highest-value test surface), (5) daily results cron + points, (6) leaderboards (weekly + overall), (7) bonus predictions + lock, (8) admin tools, (9) Docker/compose + Lefthook + CI.
4. **Execute** — subagents implement each task with RED-GREEN-REFACTOR and review gates:
   ```
   /superpowers:execute-plan
   ```
   The scoring engine and the kickoff-lock rule are where TDD pays off most; make sure those plans include the edge-case tests (exact vs result vs draw, knockout penalty bonus, idempotent recompute, writes rejected after kickoff).

Skills also activate conversationally — "use superpowers to plan the scoring engine" works without the exact slash command.

---

## Local development without Docker (optional)

You can run each side natively against the compose MySQL:

```bash
# Backend
cd backend
cp ../.env .env
go run ./cmd/server

# Frontend (new terminal)
cd frontend
pnpm install
pnpm dev          # Vite dev server with /api proxied to the backend
```

---

## Deployment

Local and production both run the same Docker images. In production, deploy `backend` and `frontend` images to AWS (ECS Fargate or a single Docker host), set `DB_*` to your **RDS MySQL** endpoint, set `TZ=Asia/Kolkata`, and provide all secrets via the environment / secrets manager. The scheduler runs inside the single backend instance; add a leader lock before scaling the backend horizontally.

---

## Troubleshooting

- **SSO rejects my login** — confirm the account is `@sayonetech.com`, the `GOOGLE_CLIENT_ID` matches the OAuth client, and the app origin is an authorised JavaScript origin in Google Cloud.
- **No fixtures appear** — run `make seed-fixtures`; check `APIFOOTBALL_KEY` and that you haven't exceeded the API's daily request limit.
- **Wrong kickoff/score** — an admin can correct it in the Admin tab; the correction is preserved (`manual_override`) and won't be overwritten by the daily job.
- **Port already in use** — adjust the host ports in `deploy/docker-compose.yml`.
