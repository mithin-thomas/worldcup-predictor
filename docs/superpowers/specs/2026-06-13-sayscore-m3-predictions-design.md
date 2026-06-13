# SayScore — Milestone 3 Design: Predictions + Server-Authoritative Kickoff Lock

**Status:** approved 2026-06-13. Source of truth for requirements remains `docs/REQUIREMENTS.md`
(§3.2 fixtures & predictions, §3.3 scoring rules, §4 privacy, §10 data model, §11 API). This
document records the M3 design decisions; it does not re-derive locked requirements.

## Goal

A signed-in user can open a fixture, set and edit a predicted score, and save it so it persists
across reloads. The **server is authoritative** for locking: any prediction write where
`now >= kickoff_utc` is rejected regardless of client state. The fixtures list shows the caller's
own predictions. Other users' predictions are never exposed before a match locks.

This slice stops at storing predictions. **Scoring is Milestone 4** — `points` and `penalty_bonus`
stay NULL here.

## Scope

In scope:

- `predictions` table (migration `0003`) and its sqlc queries + store.
- `PUT /api/matches/{id}/prediction` — create/update one prediction, with server-side lock,
  validation, and the knockout penalty-winner pick.
- `GET /api/matches` extended to attach the caller's own prediction to each match (single query).
- Fixtures UI: tap-to-expand row with a score editor, explicit **Save**, penalty-winner pick on
  knockout draws, locked/TBD read-only states.

Deferred:

- **Revealing other users' predictions after lock** (§4 allows it post-lock) — a later read feature.
  M3 still strictly enforces the privacy boundary: the API never returns others' predictions.
- **Scoring** (points, penalty bonus) — Milestone 4.
- **Knockout predictions** — see the known-teams rule below; they open as teams resolve in later
  milestones.

## Key design decision (beyond the spec) — predictions require known teams

Predictions are accepted only for matches whose home **and** away teams are known. In the seeded
dataset that is the **72 group matches**; the **32 knockout matches** carry TBD placeholders
(`W74 vs W77`) and a far-future kickoff. A score for an unknown matchup — and especially a
penalty-shootout winner, which references a concrete team — is meaningless, so:

- the server rejects prediction writes on TBD-team matches with **422 Unprocessable Entity**;
- the UI renders TBD rows as non-editable ("Teams TBD").

Knockout matches become predictable in a later milestone as their teams are filled in. This is an
implementation reading of the data model, not a spec change.

## Data model — migration `0003_create_predictions`

Columns per §10:

```
predictions
  id                       BIGINT PK AUTO_INCREMENT
  user_id                  BIGINT NOT NULL   FK -> users(id)
  match_id                 BIGINT NOT NULL   FK -> matches(id) ON DELETE CASCADE
  home_score               INT    NOT NULL
  away_score               INT    NOT NULL
  penalty_winner_team_id   BIGINT NULL       FK -> teams(id)
  points                   INT    NULL        -- set by scoring (M4)
  penalty_bonus            INT    NULL        -- set by scoring (M4)
  created_at               TIMESTAMP
  updated_at               TIMESTAMP
  UNIQUE KEY uq_pred_user_match (user_id, match_id)
  KEY idx_pred_match (match_id)               -- future reveal / leaderboard reads
ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
```

The unique key makes the write an idempotent upsert (one prediction per user per match). `ON DELETE
CASCADE` on `match_id` means an admin deleting a match (M8) cleans up its predictions.

## API (§11)

### `PUT /api/matches/{id}/prediction` (new, requires auth)

Request body:

```json
{ "home_score": 1, "away_score": 2, "penalty_winner_team_id": null }
```

Server logic, in order (first failing check wins):

1. Load the match → **404** if unknown.
2. **Lock:** `now() >= kickoff_utc` → **409 Conflict** (`{"error":"match is locked"}`). Authoritative;
   never trusts the client clock.
3. TBD-team match (home or away NULL) → **422**.
4. Validate `home_score`, `away_score` are integers in `0..99` → **422** otherwise.
5. Penalty winner: permitted **only** when `stage = knockout` AND `home_score == away_score` AND
   `penalty_winner_team_id ∈ {home_team_id, away_team_id}`. In any other case it must be null;
   a non-null value outside these rules → **422**.
6. Upsert the prediction (idempotent via the unique key); return the stored prediction, **200**,
   with `points: null`.

Other responses: **401** (no/invalid session, from `RequireAuth`).

### `GET /api/matches` (extended)

Each match in the response gains:

```json
"prediction": { "home_score": 1, "away_score": 2, "penalty_winner_team_id": null }
```

or `"prediction": null` when the caller has not predicted it. Loaded with a **single**
`user_id`-keyed query over the caller's predictions (no per-match N+1). The response never contains
any other user's prediction.

## Frontend

`MatchRow` becomes expandable:

- **Collapsed:** teams + meta as today; when a prediction exists, a compact `Your pick: 1–2`.
- **Expanded (unlocked, known teams):** two score steppers (JetBrains Mono numerics, −/+ controls,
  ≥44px targets, visible focus rings), a penalty-winner segmented control shown only when
  `stage = knockout` AND the two scores are equal, and a **Save** button (disabled until the value
  changed and is valid; loading state while saving).
- **Locked:** the saved prediction rendered read-only, lock badge + live countdown, no editor.
- **TBD teams:** non-editable, shows the placeholder label.

State: a TanStack Query `useMutation` for the PUT, pessimistic (the explicit Save covers intent).
On success, patch/invalidate the matches query. A **409** surfaces "match locked" and flips the row
to its locked state. The client countdown disables inputs at kickoff, but the server remains the
authority. Built with the `impeccable` skill against §7. Times displayed in IST.

## Testing (TDD)

Backend (the high-value surface), table-driven with fake stores + overridable `now`:

- Lock boundary: write just before kickoff accepts; at/after kickoff → 409.
- Upsert idempotency: a second PUT updates the same row, no duplicate.
- Score bounds: out-of-range / non-integer → 422.
- Penalty-winner rules: accepted on knockout draw with a valid team; rejected for non-knockout,
  non-draw, or an unrelated team id.
- TBD-team match → 422.
- Unknown match → 404; unauthenticated → 401.
- `GetMatches`: includes the caller's own prediction; uses one prediction query; never returns
  another user's prediction.

Frontend (Vitest + Testing Library):

- Row expands on tap; Save invokes the mutation with the entered scores.
- Locked row renders read-only with no editor.
- Penalty-winner control appears only for a knockout draw with known teams.
- Save disabled until changed + valid; 409 response flips the row to locked.

## Definition of Done

- A user can expand a group fixture, set/edit a score, Save, and see it persist across reload.
- Penalty-winner pick works on knockout draws once teams are known.
- The server rejects prediction writes at/after kickoff (verified by test and manually).
- No endpoint exposes another user's prediction.
- Backend (`go test ./...`) and frontend (`vitest`, `tsc --noEmit`) suites are green.
