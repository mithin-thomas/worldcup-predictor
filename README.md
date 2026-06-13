# SayScore

Internal, mobile-first web app for SayOne employees to predict FIFA World Cup 2026 match
scores, earn points, and compete on weekly and overall leaderboards.

**Stack:** Go 1.26 (chi · sqlc · golang-migrate) · React 18 + TypeScript + Vite · MySQL 8 ·
Google Workspace SSO (`sayonetech.com`) · API-Football.

- **Requirements / spec (source of truth):** [`docs/REQUIREMENTS.md`](docs/REQUIREMENTS.md)
- **Project overview:** [`docs/README.md`](docs/README.md)
- **Implementation plans (per milestone):** [`docs/superpowers/plans/`](docs/superpowers/plans/)
- **Contributor guide:** [`CLAUDE.md`](CLAUDE.md)
- **API reference:** runs at **`/docs`** (Scalar) when the backend is up — e.g. http://localhost:8000/docs

---

## Prerequisites

- **Docker** + **Docker Compose v2** — the only hard requirement to run the whole app.
- For native dev / tooling: **Go 1.26+**, **Node 20+** with **pnpm 10**, and (optional) **lefthook**.
- A **Google Workspace OAuth Client ID** (Web application) and, from Milestone 2, an **API-Football key**.

---

## Quick start (Docker — runs the whole stack)

```bash
# 1. Clone
git clone git@github.com:sayonetech/worldcup-predictor.git
cd worldcup-predictor

# 2. Create local env files (gitignored) from the template
cp .env.example backend/.env      # then edit: GOOGLE_CLIENT_ID, (later) APIFOOTBALL_KEY
cp .env.example frontend/.env     # set VITE_GOOGLE_CLIENT_ID to the same client id
#   SESSION_SECRET in backend/.env: generate one with  openssl rand -base64 48

# 3. Build + start everything (MySQL + auto-migrate + backend + frontend + Adminer)
#    The frontend bakes VITE_* at build time, so pass the client id for the build:
VITE_GOOGLE_CLIENT_ID="<your-client-id>.apps.googleusercontent.com" make up --build   # or: docker compose -f deploy/docker-compose.yml up --build
```

Then open:

| URL | What |
|---|---|
| http://localhost:8080 | the app (frontend → proxies `/api` to the backend) |
| http://localhost:8000/docs | API reference (Scalar) |
| http://localhost:8000/healthz | liveness probe |
| http://localhost:8081 | Adminer (DB inspection; server `mysql`, user/pass `wcp`) |

DB migrations run automatically on `up` (the one-shot `migrate` service); the backend waits for
them. From Milestone 2 you can also seed fixtures:

```bash
make seed-fixtures      # needs APIFOOTBALL_KEY in backend/.env
```

Sign in with a `@sayonetech.com` Google account. Accounts in `SEED_ADMIN_EMAILS` become admins.

---

## Google sign-in setup

SayScore uses **Google Identity Services (ID-token flow)** — it needs **only a Client ID**:

1. Google Cloud Console → APIs & Services → Credentials → **Create OAuth client ID → Web application**.
2. **Authorized JavaScript origins:** `http://localhost:5173` (Vite dev) and `http://localhost:8080`
   (Docker frontend); add your production origin later. **No redirect URIs needed.**
3. Copy the **Client ID** into `GOOGLE_CLIENT_ID` (backend) and `VITE_GOOGLE_CLIENT_ID` (frontend).
4. **Ignore the Client secret** Google generates — this flow doesn't use it (there is no
   `GOOGLE_CLIENT_SECRET`). See [`CLAUDE.md`](CLAUDE.md) for why.

---

## Local development without Docker (native, hot-reload)

Run MySQL in Docker but backend + frontend natively:

```bash
make up                 # just need MySQL+Adminer? this starts the full stack; or run only mysql:
                        #   docker compose -f deploy/docker-compose.yml up -d mysql
make migrate-up         # apply migrations (reads backend/.env)

make run                # backend on :8000 (auto-loads backend/.env)
make dev                # frontend on :5173 (Vite proxies /api → :8000)
```

---

## Common commands

Run `make help` for the full list. Highlights:

```text
make up / down / logs   # docker stack (compose project: sayscore)
make migrate-up         # apply DB migrations
make migrate-new name=x # scaffold a new migration pair
make sqlc               # regenerate type-safe DB code from SQL
make run / dev          # run backend / frontend locally
make seed-fixtures      # sync teams + fixtures from API-Football
make test               # backend tests
make build              # build backend binary + frontend bundle
make hooks              # install git hooks (lefthook); hooks-tools installs the tooling
```

---

## Project structure

```text
backend/    Go service — cmd/server, internal/{config,auth,httpapi,store,sportsapi,fixtures}, migrations/
frontend/   React + Vite SPA — src/{routes,components,lib,styles}, nginx.conf
deploy/     docker-compose.yml (full local stack)
docs/       REQUIREMENTS.md (spec), README.md (overview), superpowers/plans/ (milestone plans)
.github/    CI workflow
lefthook.yml  pre-commit / commit-msg / pre-push hooks
Makefile      developer commands
```

Go module path: `github.com/sayonetech/worldcup-predictor/backend`.

---

## Pre-commit hooks

Hooks run on both stacks via **Lefthook**. After cloning:

```bash
make hooks-tools   # installs lefthook + golangci-lint (once)
make hooks         # wires the git hooks
```

On commit: Go `gofmt` + `go vet` (+ `golangci-lint`/`sqlc diff` if installed), frontend
`eslint`/`prettier`/`tsc`. On push: `go test` + frontend tests. Commit messages must follow
Conventional Commits. (Optional tools are skipped gracefully if not installed.)

---

## How this project is built

SayScore is built with the [Superpowers](https://github.com/obra/superpowers) workflow:
**brainstorm → plan → TDD execution**, one milestone at a time. `docs/REQUIREMENTS.md` is the locked
spec; each milestone gets a plan in `docs/superpowers/plans/` and is executed task-by-task with
review gates. Milestone order: (1) scaffold + SSO ✅ · (2) fixtures sync + IST list · (3) predictions
+ kickoff lock · (4) scoring engine · (5) results cron · (6) leaderboards · (7) bonus + lock ·
(8) admin tools · (9) Docker/CI hardening.

---

## Troubleshooting

- **SSO rejects login** — confirm the account is `@sayonetech.com`, `GOOGLE_CLIENT_ID` matches the
  OAuth client, and your origin is an authorized JavaScript origin in Google Cloud.
- **Frontend can't reach the API** — in Docker, the frontend proxies `/api` to the `backend` service;
  natively, Vite proxies to `http://localhost:8000`. Ensure the backend is running.
- **`make up` frontend build fails on package "release age"** — `frontend/.npmrc` sets
  `minimum-release-age=0` for reproducible builds; ensure it's present.
- **Port already in use** — adjust host ports in `deploy/docker-compose.yml`.
- **Wrong kickoff/score** — an admin can correct it (Milestone 8); corrections set `manual_override`
  and aren't overwritten by the sync.
