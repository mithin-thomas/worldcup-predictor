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
  seeded from a committed SQL dump (`deploy/seed/seed.sql`).

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

MySQL is exposed on `localhost:3306` for inspection with a local client (e.g. MySQL Workbench).

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
make load-seed         # loads deploy/seed/seed.sql → 16 venues / 48 teams / 104 matches
make run               # backend  → http://localhost:8000
make dev               # frontend → http://localhost:5173  (Vite proxies /api → :8000)
```

---

## Production (Caddy + HTTPS)

The local stack (above) serves the SPA via nginx over plain HTTP. For a real
deployment use the **production compose**, which swaps nginx for **Caddy** —
automatic Let's Encrypt HTTPS, the same SPA + `/api` reverse-proxy, and an
internal-app `robots.txt` (disallow all).

```bash
cp .env.prod.example .env.prod    # fill in: SITE_ADDRESS, DB/SESSION secrets, GOOGLE_CLIENT_ID, …
make up-prod                      # build + run detached on :80 / :443
```

`make up-prod` runs `deploy/docker-compose.prod.yml` (project `sayscore-prod`):
**MySQL → migrate → seed → backend (`APP_ENV=production`) → Caddy**. Differences
from the local stack:

- **Caddy** terminates TLS for `SITE_ADDRESS` (DNS must point at the host; ports
  80 + 443 open). Certs persist in the `caddy_data` volume. Config:
  [`frontend/Caddyfile`](frontend/Caddyfile), image built from
  [`frontend/Dockerfile.prod`](frontend/Dockerfile.prod).
- **`APP_ENV=production`** turns on Secure cookies and disables the debug
  job-run route; `RESULTS_CRON_ENABLED` defaults to true.
- **Secrets come from `.env.prod`** (gitignored) — `SESSION_SECRET`,
  `GOOGLE_CLIENT_ID`, DB passwords, `FOOTBALL_DATA_API_KEY`, `SLACK_WEBHOOK_URL`.
  MySQL and the backend are **not** published to the host; only Caddy is.
- Add `https://SITE_ADDRESS` as an **Authorized JavaScript origin** on the OAuth
  client (the client id is baked into the bundle at build time).

`make down-prod` / `make logs-prod` / `make ps-prod` manage it. **Full
deployment + operations guide:** [`deploy/README.md`](deploy/README.md).

---

## Fixtures data

The WC 2026 schedule is fixed, so SayScore seeds it from a committed SQL dump,
[`deploy/seed/seed.sql`](deploy/seed/seed.sql), loaded straight into MySQL right after migrations —
no parsing at runtime. The seed uses `INSERT IGNORE`, so re-running it (every `docker compose up`)
is a no-op that never clobbers a row an admin has corrected. Kickoffs are stored UTC and shown in IST.
Rare corrections go through the admin dashboard (Milestone 8).

The dump is **generated from** the canonical CSV source in [`data/`](data/) (`teams.csv`,
`host_cities.csv`, `tournament_stages.csv`, `matches.csv`) via the Go importer. To change a fixture:
edit the CSV, run `make seed-fixtures` (normalizes venue-local times to UTC and upserts into a running
DB), then `make dump-seed` to rewrite `seed.sql`. `data/source/` holds the public-domain openfootball
dataset and `scripts/gen_fixtures.py` regenerates the CSVs from it.

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
make load-seed          # load deploy/seed/seed.sql into a running MySQL
make seed-fixtures      # author: apply data/*.csv to a DB via the Go importer
make dump-seed          # author: regenerate deploy/seed/seed.sql from the DB
make test               # backend tests
make build              # build backend binary + frontend bundle
make hooks              # install git hooks (lefthook); hooks-tools installs the tooling
```

---

## Background jobs, manual triggers & Slack

Two jobs run in-process on a cron schedule (timezone IST):

- **results-ingest** (`RESULTS_CRON`, default `0 3,8,13 * * *`) — pulls finished
  matches from football-data.org and scores predictions. Disabled if
  `FOOTBALL_DATA_API_KEY` is empty.
- **weekly-winner** (`WEEKLY_CRON`, default `30 13 * * 1`) — declares the
  previous IST week's winner(s).

### Run a job manually

In **non-production** only (`APP_ENV != production`), you can trigger a job on demand:

- **From the UI** — sign in as an admin, go to **Admin → Settings → "Background
  jobs (debug)"** and click **Run results ingest** / **Run weekly winner** /
  **Run bonus score**. The result summary is shown inline.
- **From the API** — `POST /api/admin/jobs/run` (admin session required):

  ```bash
  curl -X POST http://localhost:8000/api/admin/jobs/run \
    -H 'Content-Type: application/json' \
    --cookie "sayscore_session=<your admin session cookie>" \
    -d '{"job":"results-ingest"}'   # or "weekly-winner" | "bonus-score"
  ```

  The route is registered only when `APP_ENV != production`, so it is never
  reachable in prod.

### Slack notifications (cron heartbeat)

Set `SLACK_WEBHOOK_URL` (a Slack [Incoming Webhook](https://api.slack.com/apps))
in `backend/.env` to get a one-line status posted to a channel after **every**
job run — scheduled or manual, success or failure (with the run summary and IST
timestamp). This is the simplest way to confirm the cron is alive. Empty =
no Slack; jobs still run. Never commit a real webhook URL.

---

## Chat assistant

SayScore includes a first-party AI chat assistant (bottom-right launcher) backed by OpenAI.
History is session-only — stored in `sessionStorage`, never the DB.

**Setup (backend env vars):**

```bash
OPENAI_API_KEY=sk-...              # required to enable chat; leave blank to disable (returns 503)
OPENAI_SYSTEM_PROMPT_FILE=/path/to/prompt.txt  # text file containing the system prompt
OPENAI_MODEL=gpt-4o-mini          # optional; default is gpt-4o-mini
```

- Add these to `backend/.env` for local dev, or to `.env.prod` for production.
- `OPENAI_API_KEY` is the only required key — leaving it blank disables the chat panel with a
  503 response (the launcher renders but shows "unavailable").
- The system prompt is loaded from the file at `OPENAI_SYSTEM_PROMPT_FILE` at server start and
  injected server-side — clients never send it.

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
