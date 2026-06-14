# SayScore — Requirements & Design Specification

**SayScore** is an internal, mobile-first web app for SayOne employees to predict FIFA World Cup 2026 match scores, earn points, and compete on weekly and overall leaderboards. (Repository slug: `worldcup-predictor`.) This document is the single source of truth for scope, scoring rules, the design system, the technical stack, and the dev/ops setup. Frontend and backend live in one GitHub repository (monorepo), and the build is driven with the Superpowers plugin for Claude Code (see the README).

---

## 1. Overview & goals

Employees predict the score of every World Cup match before kickoff. Predictions are editable until kickoff, then locked. Points are awarded automatically once results settle. Winners are recognised weekly and at the end of the tournament. The app must be fast, mobile-friendly, and require near-zero manual operation once fixtures are seeded.

All times are displayed to users in **IST (Asia/Kolkata)**. Internally, timestamps are stored in **UTC**.

---

## 2. User roles

There are two roles. Role is stored on the user record and enforced by server-side middleware.

- **User** — signs in, makes/edits match predictions before kickoff, makes tournament bonus predictions before the bonus lock, views fixtures and leaderboards.
- **Admin** — everything a user can do, plus all elevated operations: trigger the results sync from the results API, add / edit / remove matches and the schedule, correct match results and penalty-shootout winners, edit configurable settings (e.g. the results-cron time, bonus lock time), promote/demote other users, and force a points recompute.

Any admin edit to a match (fixture detail or result) sets a `manual_override` flag on that match so the scheduled results job never overwrites a human correction.

---

## 3. Functional requirements

### 3.1 Authentication — Google Workspace SSO, domain-restricted

- Sign-in is Google only, restricted to the `sayonetech.com` Workspace domain.
- Frontend uses Google Identity Services to obtain an ID token; the backend verifies the token (signature, audience = our client ID, `email_verified = true`) and **gates on the `hd` (hosted-domain) claim equal to `sayonetech.com`**. The email-string check is a secondary guard, not the gate.
- On success the backend issues an httpOnly, Secure, SameSite session cookie. No passwords are ever stored.
- First sign-in auto-provisions a `User` record. Initial admins are seeded by email via configuration.

### 3.2 Fixtures & predictions

- The fixtures list is grouped by IST date. Each match shows both teams, kickoff time in IST, and a live countdown.
- A user enters a predicted score per match. Predictions can be changed any number of times **until kickoff**.
- **Locking is enforced server-side** from the stored kickoff timestamp: any write where `now >= kickoff_utc` is rejected, regardless of client state. The UI also reflects the locked state, but the server is authoritative.
- For knockout matches where the user's predicted score is a **draw**, the user may additionally pick the penalty-shootout winner (see 3.3).

### 3.3 Scoring rules

Per match:

- **Exact score** (both numbers correct): **5 points**
- **Correct result** (right winner, or correctly predicted a draw) but wrong score: **3 points**
- **Incorrect**: **0 points**

Knockout penalty bonus:

- Applies only to knockout matches that go to a penalty shootout.
- If the user predicted a **draw** for the regulation/extra-time result *and* also correctly predicted the shootout winner, they earn **+1 point**, in addition to the score points above.
- See §5 for the precise, implementable definition (confirmed in §17).

### 3.4 Tournament bonus predictions

On or before the **bonus lock** (28 June 2026, end of day IST — configurable), users may predict:

| Category | Points if correct |
|---|---|
| World Cup Winner | 30 |
| Runner-Up | 20 |
| Golden Ball Winner | 10 |
| Golden Boot Winner | 10 |
| Golden Glove Winner | 10 |
| Young Player Award Winner | 10 |
| Fair Play Trophy Winner | 10 |

Maximum bonus = **100**. These are scored once, after the tournament concludes, and added to each participant's total.

### 3.5 Leaderboards

- **Weekly**: every Monday, sum points from matches whose **kickoff** falls in the previous IST week (Mon 00:00 → Sun 23:59 IST). Attribution is by kickoff timestamp (deterministic, so a late result-correction never shifts points between weeks). Highest total(s) are the Weekly Winner(s). **Weekly ties stand** — they produce multiple co-winners, and **every co-winner is paid the full prize** (the §5.1 tie-break does **not** apply to the weekly prize; it only decides distinct 1st/2nd for the overall standings). Prize: ₹500 Amazon Gift Card per weekly winner.
- **Overall**: all match points + bonus points combined, for the final standings. **Final-standings ties are broken by the cascade in §5.1** (so 1st and 2nd are distinct winners). Prizes: 1st ₹5,000, 2nd ₹2,500.
- **Hall of Fame**: past weekly champions are retained and shown to **all** users (newest week first) — each week lists its co-winner(s), their points, and the ₹500 gift-card payout status. Read-only for regular users; admins additionally toggle the payout status (§3.6).

### 3.6 Admin features

Fixtures sync (initial seed + re-sync), manual match create/edit/delete, result and penalty-winner correction, settings management (cron time, bonus lock time, admin list), and a manual "recompute points" action. All destructive actions require an explicit confirm.

**Mark weekly prize paid** — admins mark a weekly winner's ₹500 gift card paid or unpaid via `PUT /api/admin/winners/paid`; the status surfaces in the Hall of Fame (§3.5) for everyone. This is a **standard admin route** (`RequireAdmin`) registered in **all** environments — distinct from the debug-only job triggers below, which exist only outside production.

**Debug-only job triggers** — for testing, admins can manually fire the scheduled jobs (`results-ingest`, `weekly-winner`) on demand. This is gated to non-production builds: the endpoint and its UI control exist **only when `APP_ENV != production`** and are not registered at all in production. It lets a developer run the daily ingest / weekly calc without waiting for the cron.

---

## 4. Privacy of predictions

Other participants' predictions for a match are **hidden until that match locks** (kickoff). After lock, predictions and earned points may be shown. This prevents copying and keeps the game fair. (Decision recorded in §17.)

---

## 5. Scoring engine specification

The engine is pure and **idempotent**: it recomputes points from the stored result rather than incrementing, so re-running it (or the daily job running twice) can never double-count.

```
score(prediction, match):
  if match.status != FINAL: return 0, penalty=0
  ph, pa = prediction.home, prediction.away          # predicted
  ah, aa = match.home_score, match.away_score         # actual (full/extra time)

  if ph == ah and pa == aa:           pts = 5         # exact
  elif sign(ph - pa) == sign(ah - aa): pts = 3        # correct result (incl. draw==draw)
  else:                                pts = 0

  bonus = 0
  if match.stage == KNOCKOUT and match.went_to_penalties
     and ph == pa                                     # user predicted a draw
     and pts > 0                                       # user earned score points
     and prediction.penalty_winner == match.penalty_winner:
        bonus = 1

  return pts, bonus
```

- `sign(0)` represents a draw; a predicted draw matching an actual draw scores the correct-result path.
- Points are stored on the prediction row (`points`, `penalty_bonus`) when a match goes FINAL, so leaderboard queries are simple sums over a date window.
- Bonus-prediction points are computed once at tournament end from the seven award outcomes.

### 5.1 Final-standings tie-break (overall only)

Weekly winners allow ties (co-winners). The **overall** final standings must produce distinct 1st/2nd, so equal total points are broken by this cascade — each step applied only if the previous is still tied:

1. **Total points** (the rank metric: match points + penalty bonuses + tournament bonus points). As of M7 the overall total is **live**, summing `predictions.points + penalty_bonus` plus each user's `SUM(bonus_predictions.points)`.
2. **Most exact-score predictions** (count of 5-point matches).
3. **Most correct-result predictions** (count of 3-point matches).
4. **Most correct tournament bonus picks** (count of bonus categories scored — `COUNT(bonus_predictions WHERE points > 0)`). **Live as of M7** (previously contributed 0 while the bonus feature was unbuilt).
5. **Shared rank** — if still tied, the rank is shared (effectively impossible in practice; documented for completeness).

This cascade is computed from stored per-prediction points, so it is deterministic and recompute-safe.

---

## 6. Scheduled jobs

Run in-process via a cron scheduler on a single backend instance (use a leader-lock if you later scale to multiple instances). The process timezone is `Asia/Kolkata`.

- **results-ingest** — default `0 3,8,13 * * *` (03:00 / 08:00 / 13:00 IST), stored as a configurable setting. WC 2026 matches finish across a wide IST window (~23:30 → ~12:30, since kickoffs run 21:30 IST through 09:30 IST next morning), so three intraday runs keep results fresh: 03:00 catches the evening matches plus the large 00:30-IST batch (≈19 games), 08:00 the overnight batch, 13:00 the morning finishers (including any knockout shootout). Each run pulls **FINISHED** matches from the results API over a recent **~2-day UTC window** (deliberately overlapping prior runs so a missed cron tick is still caught; the idempotent recompute makes re-fetching already-scored matches free), updates `home_score`/`away_score` + `went_to_penalties` + `penalty_winner_team_id` for matches *not* flagged `manual_override`, then recomputes points idempotently for affected predictions (re-runs are safe).
- **weekly-winner** — Mondays shortly after ingest (e.g. `30 13 * * 1`). Computes the previous Mon–Sun IST window, writes `weekly_results`, and marks winner(s), allowing ties.

Kickoff **locking is real-time** (enforced on every prediction write) and is *not* part of these jobs.

Both jobs are also invokable on demand via the **debug-only** admin trigger (§3.6), available only when `APP_ENV != production`, for local testing.

---

## 7. Design system

Design serves the task: predict fast, glance at standings. The bar is earned familiarity — it should feel as trustworthy as Linear or Stripe, not decorated.

> **Implementation note:** the frontend is built using the **`impeccable`** design skill, which realizes the tokens, layout, component states, and motion defined in this section. Treat §7 as the design contract that skill must satisfy.

### 7.1 Theme & rationale

Dark-first. The usage scene is an employee on their phone, late evening IST, locking a scoreline minutes before a North-America kickoff near midnight their time — often in a dim room. That justifies a dark default (by use, not fashion). A light theme can be added later from the same tokens; dark is canonical for v1.

Color strategy is **Restrained**: an indigo-ink canvas plus a single warm brand accent. No cream/sand backgrounds, no grass-green-and-gold football cliché, no scoreboard-terminal look.

### 7.2 Color tokens (OKLCH)

The SayOne brand color `#E95145` is the single warm accent. Because it is warm and close to danger-red, it carries **both** primary actions **and** achievement; the danger red is deepened and always icon-paired so it never reads as the primary coral.

```css
:root {
  /* Surfaces — dark indigo canvas (not navy, not terminal-black) */
  --bg:        oklch(0.17 0.020 280);
  --surface-1: oklch(0.21 0.022 280);   /* rows, panels */
  --surface-2: oklch(0.25 0.020 280);   /* elevated, inputs */
  --border:    oklch(0.32 0.020 280);

  /* Text */
  --ink:   oklch(0.96 0.010 280);       /* primary */
  --muted: oklch(0.72 0.015 280);       /* secondary — passes 4.5:1 on --bg */
  --faint: oklch(0.55 0.015 280);       /* hints, disabled labels */

  /* Brand — SayOne #E95145 — primary action + current selection + achievement */
  --brand:        oklch(0.64 0.190 28); /* ≈ #E95145 */
  --brand-hover:  oklch(0.68 0.180 28);
  --brand-active: oklch(0.58 0.180 28);
  --brand-tint:   oklch(0.40 0.100 28); /* selected / chip background on dark */
  --on-brand:     oklch(0.22 0.070 28); /* text & icons ON a brand fill */

  /* Semantics */
  --success: oklch(0.72 0.150 150);     /* correct-result badge, positive */
  --warning: oklch(0.80 0.130 75);
  --danger:  oklch(0.55 0.200 20);      /* destructive — deepened, always icon-paired */
}
```

Rules: `--brand` solid fill is reserved for **safe** primary actions and achievement only. Destructive actions use `--danger` with a leading icon (`trash`/`alert`) and a confirm step — never a coral solid fill. Body text never uses coral; coral is for accents, fills, and small emphasis.

### 7.3 Typography

One UI sans plus a monospace for all numerics — a real contrast axis, not two similar sans fonts.

- **UI / body**: Inter (with tabular figures `font-feature-settings: "tnum"` where numbers align).
- **Numerics**: JetBrains Mono — score inputs, kickoff countdowns, leaderboard point columns. Gives a quiet scoreboard character.
- Fixed `rem` scale (not fluid), ratio ≈ 1.2: 12 / 13 / 14 (UI base) / 16 (reading) / 18 / 22 / 28 px. Weights: 400 and 500 (use 600 only for the rare strong heading). Sentence case everywhere.

### 7.4 Layout

- Mobile-first. Bottom tab bar for thumb reach: Fixtures · Ranks · Bonus · Profile (plus an Admin tab visible only to admins). On wider screens the tabs become a left side-nav.
- Fixtures are a **vertical list grouped by IST date** — not an identical-card grid. Each row: teams, IST kickoff + countdown, inline score inputs, prediction state.
- Leaderboard is a true **ranked table**; rank 1 gets the brand-accent highlight.
- Admin screens use a slightly different neutral surface layer but the same component vocabulary.

### 7.5 Components & states

Every interactive component defines: default, hover, focus (visible ring), active, disabled, loading, error. Loading uses **skeletons**, not centered spinners. Empty states **teach** ("Fixtures load on first setup", "No predictions yet — tap a match"). Affordances are consistent across screens (same button shape, same form controls, same icon set). Icons: a single outline set (e.g. Tabler/Lucide outline).

A semantic z-index scale: dropdown → sticky → modal-backdrop → modal → toast → tooltip (no arbitrary 9999).

### 7.6 Motion

150–250 ms, conveying state not decoration; ease-out curves, no bounce. One earned moment: the achievement chip counts up in brand color when a finished match settles. Every animation has a `@media (prefers-reduced-motion: reduce)` fallback (crossfade/instant). No orchestrated page-load sequences.

### 7.7 Accessibility

Body text ≥ 4.5:1 contrast (verified for `--muted` on `--bg`); visible focus rings; full keyboard navigation; `aria-label`s on icon-only buttons; touch targets ≥ 44px.

---

## 8. Tech stack

**Backend**
- Go 1.22+, router `chi`
- MySQL 8 on AWS RDS; access via `database/sql` + `sqlc` (type-safe generated queries); driver `go-sql-driver/mysql`
- Migrations: `golang-migrate` (versioned SQL)
- Auth: `google.golang.org/api/idtoken` for ID-token verification; signed httpOnly session cookie
- Scheduler: `robfig/cron/v3` (in-process)
- Results data: **football-data.org v4** — competition `WC`, season `2398` (2026-06-11 → 2026-07-19); API key sent in the `X-Auth-Token` request header (not the URL). Used **only** for live results; fixtures are seeded statically (M2).
- Logging: stdlib `slog`; config via env (12-factor)

**Frontend**
- React 18 + TypeScript + Vite
- Tailwind CSS (tokens above wired as CSS variables) + shadcn/ui (Radix primitives)
- TanStack Query (data/cache), React Router, react-hook-form + zod (forms/validation)
- Google Identity Services for sign-in

**Why football-data.org**: it exposes match status, the full-time score, the winner, and crucially the shootout signal needed for the knockout penalty bonus, on a free tier sufficient for a few polls per day (10 req/min). Because fixtures are static (seeded in M2), the API is used **only** to ingest results.

**Results endpoint**: `GET /v4/competitions/WC/matches?status=FINISHED` (optionally bound with `&dateFrom=YYYY-MM-DD&dateTo=YYYY-MM-DD`, UTC dates, or narrow by `&stage=` / `&matchday=` / `&group=`); `GET /v4/matches/{id}` for a single match.

**Field mapping (football-data.org → SayScore):**

| API field | Maps to |
|---|---|
| `status == FINISHED` | score the match (set `matches.status = final`) |
| `score.fullTime.{home,away}` | `matches.home_score` / `away_score` (exact + correct-result points) |
| `score.winner` (`HOME_TEAM` / `AWAY_TEAM` / `DRAW`) | sanity-check the stored result |
| `score.duration == PENALTY_SHOOTOUT` | `matches.went_to_penalties = true` (the penalty-bonus trigger) |
| `score.winner` when a shootout | resolves `matches.penalty_winner_team_id`; `score.penalties` holds the tally |
| `stage` (`GROUP_STAGE` vs `LAST_32` … `FINAL`) | `matches.stage` (group vs knockout) |
| `id` | `matches.api_fixture_id` (match/update key) |
| `utcDate` | `matches.kickoff_utc` (displayed in IST) |

**Matching results to seeded matches**: football-data.org's `id` differs from the static seed's match number, so M5 maps each finished match to its seeded row by `(utcDate, teams)` once and stores the API `id` in `matches.api_fixture_id` for subsequent direct updates.

---

## 9. Architecture & monorepo layout

Single GitHub repository. The Go module lives inside `backend/`; module path: **`github.com/sayonetech/worldcup-predictor/backend`**.

```
.
├── backend/                 # Go service
│   ├── cmd/server/          # main entrypoint
│   ├── internal/
│   │   ├── http/            # chi routes, middleware (auth, role, CSRF)
│   │   ├── auth/            # Google ID-token verify, sessions
│   │   ├── scoring/         # pure scoring engine (heavily unit-tested)
│   │   ├── sportsapi/       # football-data.org results client
│   │   ├── jobs/            # results-ingest, weekly-winner
│   │   ├── store/           # sqlc-generated queries + db
│   │   └── config/
│   ├── migrations/          # golang-migrate SQL
│   ├── sqlc.yaml
│   └── Dockerfile
├── frontend/                # React + Vite app
│   ├── src/
│   │   ├── routes/          # Fixtures, Ranks, Bonus, Profile, Admin
│   │   ├── components/      # shared UI
│   │   ├── lib/             # api client, auth, query hooks
│   │   └── styles/tokens.css
│   ├── nginx.conf           # serves SPA, proxies /api
│   └── Dockerfile
├── deploy/
│   ├── docker-compose.yml   # local: mysql + backend + frontend(+adminer)
│   └── ...
├── docs/
│   └── REQUIREMENTS.md      # this file
├── .github/workflows/ci.yml
├── lefthook.yml             # pre-commit/pre-push for both stacks
├── Makefile
├── .env.example
└── README.md
```

The backend serves the JSON API; the frontend is a static SPA served by nginx, which also reverse-proxies `/api` to the backend (so the session cookie is first-party).

---

## 10. Data model (MySQL)

Indicative columns; refine in migrations.

- **users**: `id`, `email` (unique), `name`, `avatar_url`, `role` ENUM('user','admin'), `created_at`.
- **teams**: `id`, `api_team_id` (unique), `name`, `code`, `logo_url`.
- **players**: `id`, `source_id` (unique, football-data player id), `team_id` FK→`teams(id)`, `name`, `position`. Squad data backing the player-award bonus picks (golden ball/boot/glove, young player); seeded from a committed `data/players.csv`. Indexed on `name` for typeahead search.
- **matches**: `id`, `api_fixture_id` (unique), `stage` ENUM('group','knockout'), `round`, `home_team_id`, `away_team_id`, `kickoff_utc`, `status` ENUM('scheduled','live','final'), `home_score`, `away_score`, `went_to_penalties` BOOL, `penalty_winner_team_id` NULL, `manual_override` BOOL DEFAULT 0, `updated_at`.
- **predictions**: `id`, `user_id`, `match_id`, `home_score`, `away_score`, `penalty_winner_team_id` NULL, `points` NULL, `penalty_bonus` NULL, `created_at`, `updated_at`. **UNIQUE(user_id, match_id)**.
- **bonus_predictions**: `id`, `user_id`, `category` ENUM(winner, runner_up, golden_ball, golden_boot, golden_glove, young_player, fair_play), `ref_id` BIGINT (a team id for team awards — winner/runner_up/fair_play — or a player id for player awards — golden_ball/golden_boot/golden_glove/young_player; the category→ref-type mapping is a fixed code constant, so there is **no FK** on `ref_id` and integrity is validated server-side), `points` NULL (materialized once at tournament end). **UNIQUE(user_id, category)**.
- **bonus_results**: `category` (PK), `ref_id` (the actual outcome, same polymorphic-by-category semantics as `bonus_predictions.ref_id`), set by admin after the tournament.
- **weekly_results**: `id`, `user_id`, `week_start` (IST date), `points`, `is_winner` BOOL, `prize_paid` BOOL DEFAULT 0, `paid_at` DATETIME NULL. **UNIQUE(user_id, week_start)**.
- **settings**: `key`, `value` — e.g. `results_cron`, `bonus_lock_at`, `weekly_cron`.
- **audit_log** (optional): admin actions for traceability.

---

## 11. API (REST, JSON)

Auth & session
- `POST /api/auth/google` — body: Google ID token → verifies, sets cookie, returns user.
- `POST /api/auth/logout`
- `GET  /api/me`

Predictions & fixtures
- `GET  /api/matches` — matches grouped by IST date, with the caller's predictions and lock state.
- `GET  /api/matches/:id`
- `PUT  /api/matches/:id/prediction` — create/update; **rejected if locked**.

Leaderboards
- `GET /api/leaderboard?period=week&week=YYYY-MM-DD`
- `GET /api/leaderboard?period=overall`
- `GET /api/winners` — past weekly champions for the Hall of Fame, grouped by week, newest first: `{ "weeks": [ { "week_start": "YYYY-MM-DD", "winners": [ { "user_id", "name", "avatar_url", "points", "prize_paid" } ] } ] }`. `week_start` is the IST calendar Monday; empty → `{ "weeks": [] }`.

Bonus
- `GET /api/bonus` — the caller's picks + lock state: `{ "lock_at": RFC3339, "locked": bool, "picks": [ { "category", "ref_type": "team"|"player", "ref_id", "label", "points"? } ] }`. `label` is the resolved team/player name; `points` is present once scored; categories with no pick are omitted.
- `PUT /api/bonus` — upsert picks; body `{ "picks": [ { "category", "ref_id" } ] }` (any subset of the 7). Validates each category and that `ref_id` exists in the correct table for the category's ref-type; returns the same shape as `GET /api/bonus`. **403 when `now >= BONUS_LOCK_AT`** (server-authoritative; the client clock is never trusted); 400 on a bad category / missing or wrong-type ref / invalid JSON.
- `GET /api/teams` — `[{ id, name, code }]` for the team-award dropdowns.
- `GET /api/players?q=<term>` — `[{ id, name, team_code, position }]`, name search, capped (20 rows) for the player-award typeahead.

Admin (role=admin)
- `POST   /api/admin/fixtures/sync`
- `POST   /api/admin/matches` · `PUT /api/admin/matches/:id` · `DELETE /api/admin/matches/:id`
- `GET/PUT /api/admin/settings`
- `POST   /api/admin/recompute`
- `POST   /api/admin/users/:id/role`
- `PUT    /api/admin/winners/paid` — body `{ "week_start": "YYYY-MM-DD", "user_id", "paid": bool }` → 200 `{ "week_start", "user_id", "prize_paid" }`. Marks a weekly winner's ₹500 gift card paid/unpaid. 400 on a bad date / non-positive `user_id` / bad JSON; 404 when no matching winner row. A **standard `RequireAdmin` route, registered in all environments** (not debug-gated).
- `PUT    /api/admin/bonus/results` — body `{ "results": [ { "category", "ref_id" } ] }` → 200 `{ "saved": N }`. Upserts one or more tournament-award outcomes (validated like bonus picks: known category, `ref_id` exists in the correct table). 400 on a bad category / wrong-type ref / invalid JSON. A **standard `RequireAdmin` route, registered in all environments** (not debug-gated); the polished outcomes UI is deferred.
- `POST   /api/admin/jobs/run` — body `{ "job": "results-ingest" | "weekly-winner" | "bonus-score" }`. **Debug-only**: registered only when `APP_ENV != production`; returns 404 in production. `bonus-score` idempotently materializes `bonus_predictions.points` from `bonus_results` (recompute, never increment).

Ops
- `GET /healthz`

---

## 12. Security & privacy

- httpOnly + Secure + SameSite=Lax session cookie; short-lived, refreshed on activity.
- CSRF protection for state-changing requests (SameSite plus a CSRF token).
- Domain-restricted SSO via the `hd` claim (see 3.1).
- No secrets in the repo: `.env` is git-ignored; CI/production use GitHub Actions secrets / RDS secrets.
- Basic rate limiting on auth and prediction-write endpoints.
- Others' predictions hidden until match lock (§4).
- The debug job-trigger endpoint (`POST /api/admin/jobs/run`, §11) is registered only when `APP_ENV != production`, so manual cron invocation is impossible in production even for admins.

---

## 13. Pre-commit hooks (frontend + backend)

Use **Lefthook** — one fast binary that runs Go and JS linters on staged files in a single repo. `lefthook.yml`:

```yaml
pre-commit:
  parallel: true
  commands:
    backend-fmt:
      root: backend/
      glob: "*.go"
      run: gofmt -l -w {staged_files} && go vet ./...
    backend-lint:
      root: backend/
      glob: "*.go"
      run: golangci-lint run
    sqlc-check:
      root: backend/
      glob: "{queries/*.sql,sqlc.yaml}"
      run: sqlc diff
    frontend-lint:
      root: frontend/
      glob: "*.{ts,tsx}"
      run: pnpm eslint --fix {staged_files} && pnpm prettier --write {staged_files}
    frontend-types:
      root: frontend/
      glob: "*.{ts,tsx}"
      run: pnpm tsc --noEmit

pre-push:
  parallel: true
  commands:
    backend-test:
      root: backend/
      run: go test ./...
    frontend-test:
      root: frontend/
      run: pnpm vitest run

commit-msg:
  commands:
    conventional:
      run: pnpm commitlint --edit {1}
```

Install once per clone with `lefthook install` (wired into the Makefile / postinstall). This keeps formatting, linting, type-checks, and sqlc consistency enforced before code lands, with tests gated on push.

---

## 14. Docker & deployment

**Local & deploy both use Docker.** Local development runs the full stack via `deploy/docker-compose.yml` (MySQL + backend + frontend/nginx, plus optional Adminer for DB inspection). See `README.md` for step-by-step.

- **backend/Dockerfile** — multi-stage: build a static binary on `golang:1.22`, run on a minimal base (distroless/alpine). Migrations run via a one-shot command or an init step.
- **frontend/Dockerfile** — multi-stage: `node` build → static assets served by `nginx`, which also proxies `/api` to the backend.
- **Production** — the same images deploy to AWS (ECS Fargate or a single Docker host), pointing `DB_*` at **RDS MySQL** instead of the compose MySQL container. The scheduler runs in the single backend instance; if you scale out, add a leader lock. Set `TZ=Asia/Kolkata`.

### Environment variables

Backend: `APP_ENV`, `HTTP_PORT`, `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `SESSION_SECRET`, `GOOGLE_CLIENT_ID`, `ALLOWED_EMAIL_DOMAIN=sayonetech.com`, `SEED_ADMIN_EMAILS`, `FOOTBALL_DATA_API_KEY`, `FOOTBALL_DATA_BASE_URL=https://api.football-data.org/v4`, `RESULTS_CRON=0 3,8,13 * * *`, `WEEKLY_CRON=30 13 * * 1`, `BONUS_LOCK_AT=2026-06-28T23:59:00+05:30`, `TZ=Asia/Kolkata`.

Frontend (Vite): `VITE_GOOGLE_CLIENT_ID`, `VITE_API_BASE_URL`.

---

## 15. CI (GitHub Actions)

`.github/workflows/ci.yml` runs on PRs and main: backend (`golangci-lint`, `go test`, `sqlc diff`) and frontend (`eslint`, `tsc --noEmit`, `vitest`) in parallel, then builds both Docker images. Secrets are provided via repository/environment secrets.

---

## 16. Testing strategy

- **Scoring engine**: exhaustive table-driven unit tests (exact, correct-result, draw, knockout penalty bonus, idempotency). This is the highest-value test surface.
- **Locking**: tests that writes after `kickoff_utc` are rejected.
- **API**: handler tests with a test DB.
- **Frontend**: component tests (Vitest + Testing Library) for the prediction form and lock states; optional Playwright e2e for the predict → lock → score flow.

---

## 17. Resolved decisions

All previously-open questions were resolved in the brainstorming session (2026-06-13). Recorded here as the locked decisions:

1. **Penalty bonus interpretation** — ✅ **Confirmed as specified.** The +1 requires: knockout match, went to shootout, user predicted a draw, user's score earned points (exact or correct-result), and correct shootout winner. The penalty-winner pick is offered only when the predicted score is a draw (§3.2/§5).
2. **Bonus lock time** — ✅ **Confirmed:** 28 Jun 2026, 23:59 IST (the knockout-stage cutoff), configurable via `BONUS_LOCK_AT`.
3. **Prediction privacy** — ✅ **Confirmed:** others' predictions are hidden until a match locks at kickoff, then revealed (§4). Not always-hidden.
4. **Final-standings tie-break** — ✅ **Specified** (§5.1): cascade of total points → most exact scores → most correct-result hits → most correct bonus picks → shared rank. Applies to **overall** standings only; **weekly** winners still allow co-winners on ties (§3.5).
5. **Deployment target** — 🕒 **Deferred to deployment time.** The spec stays deployment-agnostic: Docker images for both tiers, MySQL via `DB_*` (RDS or container), single backend instance with in-process scheduler, add a leader lock before scaling out (§14). Choose ECS Fargate vs single Docker host at deploy time.
6. **Light theme** — ✅ **Confirmed:** dark-first is canonical for v1; light theme deferred, to be derived from the same §7.2 tokens later.

### 17.1 Additional decisions from the 2026-06-13 session

- **Weekly attribution by kickoff** (§3.5) — a match's points count toward the IST week containing its kickoff, so a late result-correction never shifts points across weeks.
- **Debug-only manual cron trigger** (§3.6, §6, §11) — admins can fire `results-ingest` / `weekly-winner` on demand, but only when `APP_ENV != production`.
- **Go module path** (§9) — `github.com/sayonetech/worldcup-predictor/backend`, confirmed.
- **Frontend design skill** (§7) — the frontend is implemented with the `impeccable` design skill, treating §7 as its design contract.
