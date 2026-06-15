import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getMatches, type MatchDTO, type DayDTO } from "../lib/matches";
import { istShortDate, istRelLabel } from "../lib/ist";
import { MatchCard } from "./MatchCard";
import { PastRow } from "./PastRow";
import { ChevronDownIcon } from "./icons";

const PAGE_SIZE = 6;

// ── Segmented control ──────────────────────────────────────────────────────
type SegView = "upcoming" | "past";

function Seg({ value, onChange }: { value: SegView; onChange: (v: SegView) => void }) {
  const opts: { value: SegView; label: string }[] = [
    { value: "upcoming", label: "Upcoming" },
    { value: "past", label: "Past & results" },
  ];
  return (
    <div className="seg" role="tablist" aria-label="Match view">
      {opts.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          className={`seg-btn${value === o.value ? " on" : ""}`}
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
        >
          {value === o.value && <span className="seg-bg" aria-hidden="true" />}
          <span className="seg-lbl">{o.label}</span>
        </button>
      ))}
    </div>
  );
}

// ── Date group component ────────────────────────────────────────────────────
function DateGroup({
  date,
  matches,
  view,
}: {
  date: string;
  matches: MatchDTO[];
  view: SegView;
}) {
  const rel = istRelLabel(date);
  const short = istShortDate(date);

  return (
    <div className="date-group">
      <div className="date-label">
        <span className="dl-rel">{rel ?? short.split(",")[0]}</span>
        <span className="dl-date eyebrow">{short}</span>
        <span className="dl-line" aria-hidden="true" />
      </div>
      <div className={view === "upcoming" ? "card-stack" : "past-stack"}>
        {matches.map((m) =>
          view === "upcoming" ? (
            <MatchCard key={m.id} match={m} />
          ) : (
            <PastRow key={m.id} match={m} />
          ),
        )}
      </div>
    </div>
  );
}

// ── Skeletons ──────────────────────────────────────────────────────────────
function SkeletonCard() {
  return (
    <div className="match-card" aria-hidden="true" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div className="skeleton skeleton--text" style={{ width: 160, height: 11 }} />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "8px 0" }}>
        <div className="skeleton" style={{ width: 46, height: 32, borderRadius: 5 }} />
        <div className="skeleton skeleton--text" style={{ width: 60, height: 28 }} />
        <div className="skeleton" style={{ width: 46, height: 32, borderRadius: 5 }} />
      </div>
      <div className="skeleton skeleton--text" style={{ width: "100%", height: 40, borderRadius: 8 }} />
    </div>
  );
}

function SkeletonSection() {
  return (
    <div className="date-group" aria-hidden="true">
      <div className="skeleton skeleton--text" style={{ width: 120, height: 15, marginBottom: 12 }} />
      <div className="card-stack">
        <SkeletonCard />
        <SkeletonCard />
      </div>
    </div>
  );
}

// ── Main MatchesColumn ──────────────────────────────────────────────────────
export function MatchesColumn() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["matches"],
    queryFn: getMatches,
  });

  const [view, setView] = useState<SegView>("upcoming");
  // Track shown-per-view independently so switching views resets pagination
  const [shownMap, setShownMap] = useState<Record<SegView, number>>({
    upcoming: PAGE_SIZE,
    past: PAGE_SIZE,
  });
  const shown = shownMap[view];

  function handleViewChange(v: SegView) {
    setView(v);
  }

  function loadMore() {
    setShownMap((prev) => ({ ...prev, [view]: prev[view] + PAGE_SIZE }));
  }

  // ── Loading ────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <section className="matches-col" aria-label="Loading matches" aria-busy="true">
        <div className="mcol-head">
          <Seg value="upcoming" onChange={handleViewChange} />
        </div>
        <div className="mcol-list">
          <SkeletonSection />
          <SkeletonSection />
        </div>
      </section>
    );
  }

  // ── Error ──────────────────────────────────────────────────────────────
  if (isError) {
    return (
      <section className="matches-col" aria-label="Matches" role="region">
        <div className="mcol-head">
          <Seg value={view} onChange={handleViewChange} />
        </div>
        <div
          className="empty-state"
          role="alert"
          style={{ marginTop: 32, alignSelf: "center" }}
        >
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <h2 className="empty-state__title">Could not load matches</h2>
          <p className="empty-state__body">Check your connection and try again.</p>
          <button className="btn-brand" onClick={() => void refetch()}>Retry</button>
        </div>
      </section>
    );
  }

  // ── Flatten all matches from days ──────────────────────────────────────
  const allDays: DayDTO[] = data?.days ?? [];
  const allMatches = allDays.flatMap((d) => d.matches);

  // Split on the server lock state (kickoff), not on result status: a match
  // that has kicked off but isn't scored yet is no longer predictable and
  // belongs in Past & results, not Upcoming.
  const upcoming = allMatches.filter((m) => !m.locked);
  // Past: locked (kicked-off) matches; most-recent first (reverse date order)
  const past = allMatches.filter((m) => m.locked).reverse();

  const list = view === "upcoming" ? upcoming : past;
  const visible = list.slice(0, shown);
  const remaining = list.length - shown;

  // Count upcoming without a pick (the "N matches need a pick" hint)
  const needsPick = upcoming.filter(
    (m) => m.home !== null && m.away !== null && !m.prediction,
  ).length;

  // Group visible matches by date (preserving order)
  type Group = { date: string; matches: MatchDTO[] };
  const groups: Group[] = [];
  for (const m of visible) {
    // Derive IST date from kickoff_ist string (already IST: "2026-06-12T05:30:00+05:30")
    const istDate = m.kickoff_ist.slice(0, 10);
    const last = groups[groups.length - 1];
    if (last && last.date === istDate) {
      last.matches.push(m);
    } else {
      groups.push({ date: istDate, matches: [m] });
    }
  }

  // ── Empty states ───────────────────────────────────────────────────────
  const isEmpty = list.length === 0;

  return (
    <section className="matches-col" aria-label="Matches" role="region">
      {/* ── Seg toggle + hint ─────────────────────────────────────────────── */}
      <div className="mcol-head">
        <Seg value={view} onChange={handleViewChange} />
        {view === "upcoming" && needsPick > 0 && (
          <span className="mcol-hint" aria-live="polite">
            <span className="dot" aria-hidden="true" />
            {needsPick} {needsPick === 1 ? "match needs" : "matches need"} a pick
          </span>
        )}
      </div>

      {/* ── Match list ────────────────────────────────────────────────────── */}
      {isEmpty ? (
        <div className="empty-state" style={{ marginTop: 32, alignSelf: "center" }}>
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
          <h3 className="empty-state__title">
            {view === "upcoming" ? "No upcoming matches" : "No past results yet"}
          </h3>
          <p className="empty-state__body">
            {view === "upcoming"
              ? "All matches are complete. Check Past & results for scores."
              : "Results will appear here once matches finish."}
          </p>
        </div>
      ) : (
        <div className="mcol-list">
          {groups.map((g) => (
            <DateGroup
              key={g.date}
              date={g.date}
              matches={g.matches}
              view={view}
            />
          ))}
        </div>
      )}

      {/* ── Load more ──────────────────────────────────────────────────────── */}
      {remaining > 0 && (
        <button
          type="button"
          className="load-more"
          onClick={loadMore}
          aria-label={`Load ${Math.min(PAGE_SIZE, remaining)} more matches`}
        >
          Load more
          <span className="lm-count">{remaining} left</span>
          <ChevronDownIcon />
        </button>
      )}
    </section>
  );
}
