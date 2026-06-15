# Saxone Predictions — Frontend Redesign Plan

> Applying the Claude Design "Saxone Predictions" bundle to the React SPA. The bundle (the visual contract) is at `/tmp/saxone_design/prediction-app/project/` — `app/styles.css` (tokens), `app/layout.css` (every component's styles), and the JSX mockups `main-page.jsx`, `bonus.jsx`, `components.jsx`, `admin-page.jsx`, `data.js`. Recreate the visuals **pixel-faithfully in React** (don't copy the prototype's structure verbatim) using the `impeccable` skill. **Read those files before implementing each unit.**

**Branch:** `feat/saxone-redesign`.

## Hard preservation rules (do NOT regress backend behavior)
- Keep ALL existing API wiring + TanStack Query hooks: `lib/matches.ts` (useMatches + prediction PUT), `lib/leaderboard.ts`, `lib/winners.ts` (+ admin mark-paid), `lib/bonus.ts` (useBonus/useTeams/usePlayerSearch/useSaveBonus + the bonus-results admin hooks), `lib/admin.ts`, `lib/auth.tsx` (useMe). Apply the design's LOOK to OUR data flow.
- Server-authoritative kickoff lock + bonus lock: always send writes, handle 4xx; never gate solely on the client clock. Times are UTC from the API → display IST at the edge.
- Role gating: Admin tab + admin-only controls (mark-paid, admin screen) only when `me.role === "admin"`. **Drop the design's Player/Admin switcher entirely** (it was a preview toggle).
- Privacy: others' predictions only after a match locks (unchanged).
- credentials:"include" on all fetches (via the existing clients).

## Decisions (from the user)
- **2 tabs:** Predictions + Admin. **Bonus is merged into the Home page** (collapsible gold panel), no Bonus tab.
- **Logo:** put our existing `src/assets/sayscore-logo-transparent.png` in the design's top-left logo-slot position (the design left it as a placeholder; we have a logo).
- Full faithful redesign (IA + components), not just a theme layer.

## Design token system (from styles.css) — replace `src/styles/tokens.css`
- Accent coral `#fb5740` (+ hi/press/soft/ring); blue `#5b8def`; win `#34d399`; gold `#f5b13c`; loss `#f4615b`.
- Deep-ink-navy surfaces: `--bg #070912`, `--surface #10131f`, `--surface-2/3`, `--hover`, layered borders.
- Text ramp `--text #eef1fa` → `--text-faint`. Fonts: **Space Grotesk** (display), **Hanken Grotesk** (sans/body), **JetBrains Mono** (numerics). Radii xs..pill, shadows sm/md/lg + glow, `.app-bg` ambient radial gradient, `.mono`/`.eyebrow` utilities, fadeUp/pop/shimmer keyframes (content must NOT depend on entrance animations for visibility — per the chat fix).
- Fonts: add Space Grotesk + Hanken Grotesk + JetBrains Mono (via `@fontsource/*` packages or a Google Fonts `<link>` in index.html). JetBrains Mono is likely already present — verify.
- Keep theme variants (`data-theme` midnight/charcoal) optional; default ink is canonical (dark-first, no light theme).

## Units (each: read the relevant design files → build with impeccable → ui-review → next)

1. **Foundation: tokens + app shell.** Replace `tokens.css` with the Saxone token system + port `layout.css` shell/topbar/nav/seg/pill/flag/avatar/etc. classes (adapt to our class usage). Add fonts. `App.tsx`: ambient `.app-bg`; sticky `.topbar` with the logo-slot (our logo) left, centered pill `.topbar-nav` with **Predictions + Admin** (Admin only when admin), `.user-chip` + logout right; remove the player/admin switcher; render `<Home/>` or `<Admin/>` by tab. Keep the existing auth/login gate (restyle lightly to the tokens).
2. **Home left column: Bonus panel + matches.** Move Bonus into Home as the collapsible gold `.bonus-panel` (reuse `lib/bonus.ts` + the searchable team/player pickers — the M7 `PlayerCombobox` + team search-dropdown per the design's `.bonus-menu`/`.bonus-search`). Then the matches column: `.seg` **Upcoming / Past & results** toggle; date-grouped `.match-card` scoreboard cards with the big mono scoreline + ± `.stepper` per team + `.btn-save` ("Save pick" → "Update pick" → "Saved ✓"), locked state for started matches; **Past** view = `.past-row` with final score + your pick + points chip (5 exact / 3 correct / 0 — use OUR scoring values from the prediction's points); **Load more** 6 at a time. Wire to `useMatches` (the prediction PUT, kickoff lock, IST).
3. **Home sidebar.** `.standing` card (caller's rank/points/gap-to-next from the leaderboard `me`), `.lb` leaderboard with Overall/Weekly `.seg-sm` toggle (`lib/leaderboard.ts`), and `.hof` Hall of Fame with **Prev/Next week paging** (client-side over `lib/winners.ts` weeks, newest first) + `.pay-badge` (admin → "Mark paid" button; player → Paid/Pending badge).
4. **Admin screen.** Reskin `routes/Admin.tsx` to the design's admin (centered `.seg` Matches|Users|Settings|Bonus — keep our existing M8 tabs/functionality; the design shows Matches + Users, apply that look and extend the same styling to Settings + Bonus-outcomes tabs). `.adm-match` rows (Edit/Result/Delete + New match) + `.adm-table` users table with role tags. Preserve all M8 admin behavior + confirm dialogs.
5. **Verify + polish.** Update/rewrite affected component tests (MatchRow→match card, HallOfFame, LeaderboardPanel, Bonus-on-home, Admin) so `pnpm vitest run` is green; `pnpm tsc --noEmit` + `pnpm build` clean; ui-review pass; live smoke in the browser (rebuild frontend container).

## Notes
- Icons: the design uses inline SVG/emoji-ish icons; use a single consistent outline set (lucide-react if available, else inline SVG) — match the design's icon placements (nav, bonus, countdown, trophy, chevrons, arrows).
- `data.js` is mock data — ignore its values; use OUR live hooks.
- The Tweaks panel (theme/accent switcher) from the design is a dev tool — do NOT ship it.
