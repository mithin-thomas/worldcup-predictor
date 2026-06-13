# SayScore

Internal, mobile-first web app for SayOne employees to predict FIFA World Cup 2026 match
scores, earn points, and compete on weekly and overall leaderboards.

**Stack:** Go 1.26 (chi · sqlc · golang-migrate) · React 18 + TypeScript + Vite · MySQL 8 ·
Google Workspace SSO (`sayonetech.com`). Fixtures come from a committed static dataset
(`data/*.csv`) — no external sports API.

- **Requirements / spec (source of truth):** [`docs/REQUIREMENTS.md`](docs/REQUIREMENTS.md)
- **Project overview:** [`docs/README.md`](docs/README.md)
- **Implementation plans (per milestone):** [`docs/superpowers/plans/`](docs/superpowers/plans/)
- **Contributor guide:** [`CLAUDE.md`](CLAUDE.md)
- **API reference:** runs at **`/docs`** (Scalar) when the backend is up — e.g. <http://localhost:8000/docs>

---

## Prerequisites

- **Docker** + **Docker Compose v2** — the only hard requirement to run the whole app.
- For native dev / tooling: **Go 1.26+**, **Node 20+** with **pnpm 10**, plus `sqlc` and
  `golang-migrate` (`go install`), and (optional) **lefthook**.
- A **Google Workspace OAuth Client ID** (Web application). **No API key needed** — fixtures are
  seeded from the committed CSV dataset.

---

## Run it (Docker — one command)

Everything runs in Docker; you don't need Go or Node installed.

```bash
# 1. Clone + env files (gitignored)
git clone git@github.com:sayonetech/worldcup-predictor.git
cd worldcup-predictor
cp .env.example backend/.env      # set GOOGLE_CLIENT_ID; SESSION_SECRET=$(openssl rand -base64 48)
cp .env.example frontend/.env     # set VITE_GOOGLE_CLIENT_ID (same id)

# 2. Build + run the whole stack
make up
```

`make up` builds the images and starts the stack in order: **MySQL → migrate → seed (loads
`data/*.csv`: 16 venues / 48 teams / 104 matches) → backend → frontend**. Migrations and the fixture
seed are one-shot services the backend waits on, so a single command gives you a fully working app.

| URL | What |
|---|---|
| <http://localhost:8080> | the app (frontend → proxies `/api` to the backend) |
| <http://localhost:8000/docs> | API reference (Scalar) |
| <http://localhost:8000/healthz> | liveness probe |
| <http://localhost:8081> | Adminer (DB inspection; server `mysql`, user/pass `wcp`) |

Open **http://localhost:8080** and sign in with a `@sayonetech.com` Google account → the Fixtures list
(grouped by IST date, with group + venue; knockout placeholders show labels like `W73 vs W75`).
Accounts in `SEED_ADMIN_EMAILS` become admins on first login. `make up` runs in the **foreground with
live logs** (Ctrl-C to stop) — handy for debugging; use **`make up-d`** to run detached and `make logs`
to follow. `make down` stops and removes the stack.

> **Sign-in prerequisite:** add `http://localhost:8080` (and `http://localhost:5173` for native dev)
> as an **Authorized JavaScript origin** on your OAuth client — see
> [Google sign-in setup](#google-sign-in-setup).

---

## Run it (native — hot-reload dev)

Run only MySQL in Docker; run backend + frontend natively for fast iteration (needs Go + pnpm):

```bash
docker compose -p sayscore -f deploy/docker-compose.yml up -d mysql
make migrate-up        # applies users + teams/venues/matches schema
make seed-fixtures     # imports data/*.csv → 16 venues / 48 teams / 104 matches
make run               # backend  → http://localhost:8000
make dev               # frontend → http://localhost:5173  (Vite proxies /api → :8000)
```

---

## Fixtures data

The WC 2026 schedule is fixed, so SayScore ships it as committed CSVs in [`data/`](data/) —
`teams.csv`, `host_cities.csv` (venues), `tournament_stages.csv`, `matches.csv`. `make seed-fixtures`
imports them idempotently (it never overwrites a row an admin has corrected — `manual_override`).
Kickoffs are stored UTC (the CSV times are venue-local with an offset, normalized on import) and shown
in IST. Rare corrections are made via the admin dashboard (Milestone 8), not by re-importing.

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

## Common commands

Run `make help` for the full list. Highlights:

```text
make up / down / logs   # docker stack (compose project: sayscore)
make migrate-up         # apply DB migrations
make migrate-new name=x # scaffold a new migration pair
make sqlc               # regenerate type-safe DB code from SQL
make run / dev          # run backend / frontend locally
make seed-fixtures      # import teams, venues, and fixtures from data/*.csv
make test               # backend tests
make build              # build backend binary + frontend bundle
make hooks              # install git hooks (lefthook); hooks-tools installs the tooling
```

---

## Project structure

```text
backend/    Go service — cmd/server, cmd/seedfixtures,
            internal/{config,auth,httpapi,store,importer}, migrations/
frontend/   React + Vite SPA — src/{routes,components,lib,styles}, nginx.conf
data/       committed WC2026 dataset (teams, host_cities, tournament_stages, matches CSVs)
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

- **On commit (fast):** Go `gofmt`; frontend `eslint` + `prettier` on staged files;
  `sqlc diff`; `golangci-lint` — optional tools are skipped gracefully if not installed.
- **On push:** `go vet ./...`, `go test ./...`, frontend `tsc --noEmit` + `vitest`.
- Commit messages must follow **Conventional Commits**.

---

## How this project is built

SayScore is built with the [Superpowers](https://github.com/obra/superpowers) workflow:
**brainstorm → plan → TDD execution**, one milestone at a time. `docs/REQUIREMENTS.md` is the locked
spec; each milestone gets a plan in `docs/superpowers/plans/` and is executed task-by-task with
review gates. Milestone order: (1) scaffold + SSO ✅ · (2) fixtures + IST list ✅ · (3) predictions
+ kickoff lock · (4) scoring engine · (5) results cron · (6) leaderboards · (7) bonus + lock ·
(8) admin tools · (9) Docker/CI hardening.

---

## Troubleshooting

- **SSO rejects login** — confirm the account is `@sayonetech.com`, `GOOGLE_CLIENT_ID` matches the
  OAuth client, and your origin is an authorized JavaScript origin in Google Cloud.
- **Frontend can't reach the API** — in Docker, the frontend proxies `/api` to the `backend` service;
  natively, Vite proxies to `http://localhost:8000`. Ensure the backend is running.
- **No fixtures shown** — run `make seed-fixtures` (needs MySQL up + migrations applied).
- **`make ... up --build` frontend build fails on package "release age"** — `frontend/.npmrc` sets
  `minimum-release-age=0` for reproducible builds; ensure it's present.
- **Port already in use** — adjust host ports in `deploy/docker-compose.yml`.
- **Wrong kickoff/teams** — an admin can correct it (Milestone 8); corrections set `manual_override`
  and aren't overwritten by re-seeding.
