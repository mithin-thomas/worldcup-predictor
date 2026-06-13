# CLAUDE.md — SayScore (worldcup-predictor)

Guidance for Claude Code when working in this repository. Read this first.

## What this is

**SayScore** is an internal, mobile-first web app for SayOne employees to predict FIFA
World Cup 2026 match scores, earn points, and compete on weekly and overall leaderboards.
Internal use only; Google Workspace SSO restricted to `sayonetech.com`.

## Source of truth

- **`docs/REQUIREMENTS.md` is the locked spec.** Scope, scoring rules, data model, API
  surface, design system, security — all live there. Do **not** re-derive requirements or
  re-litigate settled decisions; read the spec and follow it. Section numbers below refer to it.
- **`docs/superpowers/plans/`** holds per-milestone implementation plans (one vertical slice
  each). Execute plans task-by-task with TDD; don't free-form around them.
- Relative dates in conversation are converted to absolute in the spec/plans. Today's project
  baseline: spec finalized 2026-06-13.

## Locked decisions (quick reference — full detail in spec §17 + §3 + §5)

- **Scoring (§3.3/§5):** 5 = exact score, 3 = correct result (right winner or draw, any score),
  0 = wrong. No goal-difference tier.
- **Knockout penalty bonus (§5):** +1 only when — knockout match, went to a shootout, user
  predicted a draw, user's score earned points, and the user picked the correct shootout winner.
- **Tournament bonus (§3.4):** 7 categories, max 100 (Winner 30, Runner-Up 20, then Golden Ball /
  Boot / Glove / Young Player / Fair Play at 10 each). Locks `BONUS_LOCK_AT` (28 Jun 2026 IST).
- **Leaderboards (§3.5/§5.1):** weekly = points by **match kickoff** within Mon–Sun IST, ties
  produce co-winners; overall breaks ties via the §5.1 cascade (total → exact hits → correct-result
  hits → bonus hits → shared).
- **Roles (§2):** exactly `user` and `admin`. Admins fully participate AND get admin tools
  (match CRUD, result/penalty correction, settings, promote/demote, recompute, debug cron).
  Seeded via `SEED_ADMIN_EMAILS`; promotion thereafter via `POST /api/admin/users/:id/role`.
- **Privacy (§4):** others' predictions hidden until a match locks at kickoff, then revealed.
- **Theme (§7):** dark-first is canonical for v1; light deferred.
- **Deployment (§14/§17):** deferred to deploy time; keep deployment-agnostic.

## Stack & layout

- **Backend:** Go 1.22+ · module **`github.com/sayonetech/worldcup-predictor/backend`** (lives in
  `backend/`) · `go-chi/chi/v5` · MySQL 8 via `database/sql` + **sqlc** + `go-sql-driver/mysql` ·
  migrations with **golang-migrate** · auth via `google.golang.org/api/idtoken` + HMAC-signed
  session cookie · scheduler `robfig/cron/v3` (in-process) · `slog` · API-Football for data.
- **Frontend:** React 18 + TS + Vite · Tailwind + shadcn/ui · TanStack Query · React Router ·
  react-hook-form + zod · Google Identity Services.
- **Monorepo:** `backend/` `frontend/` `deploy/` `docs/`. See spec §9 for the full tree.

## Times

Store **UTC**, display **IST (Asia/Kolkata)**. Scheduler/process `TZ=Asia/Kolkata`.

## Working conventions

- **TDD always** (Superpowers brainstorm → plan → execute). RED → GREEN → REFACTOR, one bite-sized
  step at a time, frequent commits. The **pure scoring engine (`internal/scoring/`) is the
  highest-value test surface** — exhaustive table-driven tests (exact, correct-result, draw,
  knockout penalty bonus, idempotent recompute).
- **Server is authoritative** for kickoff locking: reject any prediction write where
  `now >= kickoff_utc`, regardless of client state (§3.2). Never trust the client for lock state.
- **Scoring is idempotent:** recompute points from the stored result, never increment, so a job
  running twice can't double-count.
- **sqlc:** edit SQL in `backend/internal/store/queries/`, then `make sqlc`. The generated code in
  `internal/store/sqlc/` is authoritative for field/type names — adapt callers to it, don't hand-edit it.
- **Migrations:** add a numbered up/down pair in `backend/migrations/`; never edit an applied migration.
- **Debug-only cron trigger** (`POST /api/admin/jobs/run`) must be registered **only when
  `APP_ENV != production`** — never reachable in prod.
- **Commits:** Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`, scope where useful).
- **Secrets:** never commit `.env`; config is 12-factor via environment.

## Commands (Makefile)

```text
make up            # docker compose up -d (MySQL + Adminer) for local dev
make down          # stop the local stack
make migrate-up    # apply DB migrations (needs golang-migrate CLI + DB_* env)
make migrate-down  # roll back the last migration
make sqlc          # regenerate type-safe DB code from internal/store/queries/*.sql
make test          # backend: go test ./...   (add frontend vitest in M9)
make lint          # backend: go vet ./...     (golangci-lint wired via hooks)
```

Backend dev run: `cd backend && go run ./cmd/server` (with `DB_*`, `SESSION_SECRET`,
`GOOGLE_CLIENT_ID`, `ALLOWED_EMAIL_DOMAIN` set). Frontend dev: `cd frontend && pnpm dev`
(Vite proxies `/api` → `http://localhost:8000`). Adminer for DB inspection: <http://localhost:8081>.

## Pre-commit hooks (Lefthook) — spec §13

Hooks run on both stacks via **Lefthook** (`lefthook.yml`); install once per clone with
`lefthook install` (wired into the Makefile in Milestone 9). They enforce:

- **pre-commit (staged files, parallel):** Go `gofmt -w` + `go vet` + `golangci-lint run` +
  `sqlc diff` (fails if generated code is stale — run `make sqlc` and commit); frontend
  `eslint --fix` + `prettier --write` + `tsc --noEmit`.
- **pre-push:** `go test ./...` and `pnpm vitest run`.
- **commit-msg:** `commitlint` against Conventional Commits.

If a hook fails, fix the cause — don't `--no-verify`. A stale-sqlc failure means you edited SQL but
didn't regenerate: `make sqlc`, then re-stage. (Lefthook config itself lands in Milestone 9; follow
these rules from the start.)

## Database & query optimisation

MySQL 8, accessed only through **sqlc**-generated, parameterized queries (never string-built SQL).
Use the `sayscore-db-engineer` agent for non-trivial schema/query work.

- **Migrations:** numbered up/down pairs in `backend/migrations/`; never edit an applied migration —
  add a new one; the down must reverse the up. InnoDB + utf8mb4. Timestamps stored UTC
  (`parseTime=true&loc=UTC`).
- **Materialized points:** when a match goes FINAL, scoring SETs `predictions.points` /
  `penalty_bonus` (idempotently — recompute, never increment). **Leaderboards are plain SUMs over
  these stored points** — never recompute scores on read.
- **Read paths to keep fast:** the leaderboard (sum points per user over a week/overall window) and
  the fixtures list (a user's predictions across all matches). Load predictions for the list in a
  **single** `user_id`-keyed query — avoid N+1 per match.
- **Indexes:** unique keys enforce invariants (`users.email`, `matches.api_fixture_id`,
  `predictions(user_id, match_id)`, `bonus_predictions(user_id, category)`,
  `weekly_results(user_id, week_start)`). Index `matches.kickoff_utc` (fixtures grouping + weekly
  attribution by kickoff). Add covering indexes only when `EXPLAIN` justifies them; don't slow
  writes with speculative indexes.
- **Transactions:** wrap multi-statement invariants (recompute + `weekly_results` write) in one tx.
- **Pooling:** the pool is configured in `store.OpenMySQL`; tune `MaxOpenConns` to the deployment,
  not per-request.

## Frontend (`frontend/`)

Both stacks share this repo; the SPA is a first-class half of it. Use `sayscore-frontend-engineer`
to build and `sayscore-ui-reviewer` to review.

**Stack:** React 18 + TypeScript + Vite · Tailwind + shadcn/ui (Radix primitives) · TanStack Query
(server state/cache) · React Router · react-hook-form + zod (forms/validation) · Google Identity
Services (sign-in).

**Structure (spec §9):**

```text
frontend/src/
  routes/      # Fixtures, Ranks, Bonus, Profile, Admin (route-level screens)
  components/  # shared UI (shadcn/ui-based), one outline icon set
  lib/         # api client, auth hooks, TanStack Query hooks
  styles/tokens.css   # dark-first OKLCH tokens (spec §7.2), wired to Tailwind
```

**Data & state:**

- One typed API client in `src/lib/`; **all** fetches use `credentials: "include"` (first-party
  session cookie). API base is `VITE_API_BASE_URL` (`/api`), proxied to the backend in dev.
- TanStack Query for every server resource (`useMe`, fixtures, leaderboard, bonus). Keep server state
  in Query, not React state. Optimistic prediction edits are fine but must reconcile with the server
  response (a lock rejection rolls back).
- Forms via react-hook-form + zod. Client validation is UX only — **the server is authoritative**
  for kickoff lock and score validity.

**Non-negotiable behavioral contracts:**

- **Kickoff lock (§3.2):** disable inputs and show a live countdown at/after kickoff, but always send
  the write and handle a server 4xx — never trust the client clock alone.
- **Times:** API returns **UTC**; display everything in **IST** — convert at the edge, never render
  raw UTC.
- **Privacy (§4):** render other users' predictions only after a match has locked.
- **Roles:** show the Admin tab/section only when `me.role === "admin"`.

**Design system (spec §7):** dark-first; tokens in `styles/tokens.css`. Build screens with the
**`impeccable`** design skill, treating §7 as the contract. Inter for UI, **JetBrains Mono for all
numerics** (scores, countdowns, points). Coral `--brand` only for safe primary actions + achievement;
destructive = `--danger` + icon + confirm. Every interactive element defines default/hover/focus
(visible ring)/active/disabled/loading/error; **skeletons not spinners**; teaching empty states.
Accessibility: ≥4.5:1 contrast, keyboard nav, `aria-label` on icon buttons, ≥44px targets,
`prefers-reduced-motion` fallbacks. Mobile-first: bottom tab bar → side-nav on wide screens; fixtures
are a vertical list grouped by IST date; leaderboard is a ranked table.

**Build & test:** `pnpm dev` (Vite, proxies `/api` → `:8000`), `pnpm build`, `pnpm tsc --noEmit`,
`pnpm vitest run`. Component tests (Vitest + Testing Library) cover the prediction form's lock states
and key rendering; type-check must be clean before done.

## Custom subagents (in `.claude/agents/`)

Use these proactively:

- **`sayscore-verifier`** — run after a logical chunk of work: builds, vets, lints, and runs the full
  backend + frontend test suite; reports pass/fail with output and checks the milestone Definition of Done.
- **`sayscore-architecture-reviewer`** — reviews changes against spec §9 layout and boundary rules
  (pure scoring engine has zero I/O, handlers depend on the `Store` interface, etc.). Read-only.
- **`sayscore-test-engineer`** — authors/reviews table-driven Go tests and Vitest tests; enforces TDD
  and coverage of edge cases, especially scoring and kickoff-locking.
- **`sayscore-security-reviewer`** — reviews auth/session/SSO/admin paths against spec §12 (hd gate,
  cookie flags, CSRF, rate limiting, prod-only gating of debug routes). Read-only.
- **`sayscore-db-engineer`** — migrations (golang-migrate), sqlc queries, schema/index design, and
  query-performance optimisation (leaderboard sums, weekly windows, N+1 avoidance, EXPLAIN).
- **`sayscore-frontend-engineer`** — builds React/TS/Vite features (prediction form, fixtures,
  leaderboards, bonus, admin) against the §7 design contract via the `impeccable` skill.
- **`sayscore-ui-reviewer`** — audits frontend code against §7 (tokens, component states, skeletons,
  empty states, accessibility, IST display, lock-state UX). Read-only.

## Codebase graph (MCP)

This project has a `code-review-graph` knowledge graph. Prefer the graph MCP tools
(`semantic_search_nodes`, `query_graph`, `get_impact_radius`, `detect_changes`,
`get_review_context`) over Grep/Glob/Read for exploration, impact analysis, and review — they're
faster and give structural context. Fall back to file tools when the graph doesn't cover it.

## Milestone roadmap & status

Order (each its own plan → execute): (1) **scaffold + SSO** ← *M1 plan written, not yet executed*,
(2) fixtures sync + IST list, (3) predictions + kickoff lock, (4) scoring engine, (5) results cron +
points, (6) leaderboards, (7) tournament bonus + lock, (8) admin tools, (9) Docker/compose +
Lefthook + CI.

Current state: greenfield. `docs/REQUIREMENTS.md` (spec) and the M1 plan exist; no app code yet.
