# Contributing to SayScore

Anyone on the team can add features and fixes. This guide is the short version of
how to get a change merged cleanly.

> **First, read two files:** [`CLAUDE.md`](CLAUDE.md) (conventions) and
> [`docs/REQUIREMENTS.md`](docs/REQUIREMENTS.md) (**the locked spec — the source of
> truth**). The automated review checks your PR against the spec, so keep them in sync
> (see [Update the spec](#1-update-the-spec-required)).

---

## Local setup

```bash
git clone git@github.com:sayonetech/worldcup-predictor.git
cd worldcup-predictor
cp .env.example backend/.env       # set GOOGLE_CLIENT_ID; SESSION_SECRET=$(openssl rand -base64 48)
cp .env.example frontend/.env      # set VITE_GOOGLE_CLIENT_ID (same id)
make up                            # full stack in Docker → http://localhost:8080
make hooks-tools && make hooks     # install the git hooks (once)
```

For native/hot-reload dev (`make run` + `make dev`) and the full command list, see
[`README.md`](README.md). Production deployment lives in [`deploy/README.md`](deploy/README.md).

---

## Workflow

1. **Branch off `main`** — `feat/<short-name>`, `fix/<short-name>`, or `docs/<short-name>`.
2. **Write tests (TDD).** Backend: table-driven Go tests (the pure scoring engine and
   server-side locks are the highest-value surfaces). Frontend: Vitest + Testing Library
   (lock/window states, key rendering). A feature without tests will not pass review.
3. **Follow the conventions** (full detail in [`CLAUDE.md`](CLAUDE.md)):
   - Go: `gofmt`, `go vet`, `golangci-lint` clean.
   - **sqlc**: edit SQL in `backend/internal/store/queries/`, then `make sqlc`. Never hand-edit
     generated code.
   - **Migrations**: numbered up/down pairs in `backend/migrations/`; never edit an applied one.
   - Frontend: TypeScript, the §7 design system, `eslint`/`prettier`/`tsc` clean.
   - **Server is authoritative** for locks/validation; store UTC, display IST.
   - **Never commit secrets** — `.env*` stay local (gitignored).
4. **Conventional Commits** (`feat:`, `fix:`, `docs:`, `chore:`, scope where useful). The
   commit-msg hook enforces this. Fix hook failures — don't `--no-verify`.
5. **Green locally before pushing**:
   - Backend: `make test` (runs `go test ./...`).
   - Frontend: `make test-frontend` (Vitest), or `cd frontend && pnpm tsc --noEmit && pnpm vitest run`.
   - Both build: `make build` (backend binary + frontend bundle).

---

## Required for every PR

### 1. Update the spec (REQUIRED)

If your change adds or changes any user-facing behavior, **add/edit it in
[`docs/REQUIREMENTS.md`](docs/REQUIREMENTS.md) in the same PR.** This is not optional:

- It keeps the spec the single source of truth.
- **The automated Claude review checks each PR against `docs/REQUIREMENTS.md`.** A feature
  that isn't in the spec gets flagged as a "spec violation," so a *new* feature must be
  documented there as part of the PR.

> An AI assistant (e.g. Claude Code) will usually make this spec edit for you as part of the
> change — but **verify the spec update is actually in your PR's diff** before requesting
> review. If it's missing, add it.

⚠️ **Locked decisions are not self-amendable.** The spec records *settled* decisions —
notably the SSO `sayonetech.com` gate (§2/§12), server-authoritative kickoff/window locks
(§3.2), admin roles (§2), and prediction privacy/reveal (§4). Adding a *new* feature to the
spec is expected; **changing or weakening a locked decision requires explicit maintainer
sign-off** and cannot be settled by editing the spec in the same PR (don't use a same-PR
spec edit just to make the automated reviewer pass). When in doubt, ask a maintainer first.

Docs/chore-only PRs (no behavior change) can skip this.

### 2. Describe the change in the PR

The PR template prompts for this. Include:

- **A clear description** of the feature/change and *why*.
- **Screenshots or a short recording** for any UI change (before/after is ideal). For API
  or backend-only changes, note the endpoints/behavior and example requests.
- **How you tested it** (commands run, scenarios checked).

### 3. Gates that must be green to merge

- **CI (GitHub Actions)** — build, lint, tests, and `sqlc diff`, for both backend and
  frontend. Must be green.
- **Claude automated review** — must pass. Address each finding by fixing it, or, if a
  finding is an intentional product decision, **reply on the PR explaining why** (and make
  sure the spec reflects it). Don't ignore findings.
- Any required human approval per branch protection.

After review, push fixes to the same branch — CI and the review re-run automatically.

---

## Tips for a smooth review

- **Keep PRs focused** — one feature/fix per PR. Smaller PRs review faster and revert cleanly.
- If you touch the scoring, locking, leaderboard, or admin paths, call it out in the
  description and add edge-case tests.
- When in doubt about a rule, the spec wins; if the spec is silent and you're adding new
  behavior, decide, implement, **and write it into the spec** so it's settled.
