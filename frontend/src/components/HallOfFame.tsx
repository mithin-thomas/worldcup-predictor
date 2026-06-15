/**
 * HallOfFame — rebuilt with single-week PREV/NEXT navigation.
 *
 * Weeks are ordered newest-first (index 0 = most recent).
 * Prev arrow = more recent week (disabled at 0).
 * Next arrow = earlier week (disabled at last index).
 *
 * Admin: mark-paid per-row toggle with per-row pending state.
 * Non-admin: paid/pending badge.
 * Preserves existing inline error from useMarkWinnerPaid.
 */

import { useState } from "react";
import { useWinners, useMarkWinnerPaid } from "../lib/winners";
import { useMe } from "../lib/auth";
import { weekRange, currentISTMonday } from "../lib/ist";
import { Avatar } from "./Avatar";
import { TrophyIcon, CheckIcon } from "./icons";

// Chevron left (rotate 0 = down; left is rotate(90deg))
function ChevronLeft() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
      strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
      style={{ transform: "rotate(90deg)" }}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

// Chevron right (rotate -90deg)
function ChevronRight() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
      strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
      style={{ transform: "rotate(-90deg)" }}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

export function HallOfFame() {
  const { data, isLoading, isError } = useWinners();
  const me = useMe();
  const isAdmin = me.data?.role === "admin";
  const markPaid = useMarkWinnerPaid();

  // wi = current week index (0 = newest)
  const [wi, setWi] = useState(0);

  // Identify in-flight row by week_start + user_id for per-row pending
  const pendingWeek = markPaid.variables?.week_start;
  const pendingUser = markPaid.variables?.user_id;

  // Compute the current IST Monday to show "This week" pill
  const thisMonday = currentISTMonday();

  // --- Skeleton ---
  if (isLoading) {
    return (
      <div className="card hof" aria-label="Hall of Fame" aria-busy="true">
        <div className="hof-head">
          <h3 className="panel-title">
            <span className="hof-trophy"><TrophyIcon /></span>
            Hall of Fame
          </h3>
          <span className="hof-sub eyebrow">₹500 / week</span>
        </div>
        <div aria-hidden="true" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div className="skeleton" style={{ height: 48, borderRadius: "var(--r-md)", width: "100%" }} />
          {[1, 2].map((i) => (
            <div key={i} className="skeleton" style={{ height: 60, borderRadius: "var(--r-md)", width: "100%" }} />
          ))}
        </div>
      </div>
    );
  }

  // --- Error ---
  if (isError) {
    return (
      <div className="card hof" aria-label="Hall of Fame">
        <div className="hof-head">
          <h3 className="panel-title">
            <span className="hof-trophy"><TrophyIcon /></span>
            Hall of Fame
          </h3>
          <span className="hof-sub eyebrow">₹500 / week</span>
        </div>
        <p className="hof__empty" role="alert">Couldn&apos;t load past winners.</p>
      </div>
    );
  }

  // --- Empty state ---
  if (!data || data.weeks.length === 0) {
    return (
      <div className="card hof" aria-label="Hall of Fame">
        <div className="hof-head">
          <h3 className="panel-title">
            <span className="hof-trophy"><TrophyIcon /></span>
            Hall of Fame
          </h3>
          <span className="hof-sub eyebrow">₹500 / week</span>
        </div>
        <p className="hof__empty">
          No champions yet — the first weekly winner is crowned Monday.
        </p>
      </div>
    );
  }

  // Sort weeks newest-first
  const weeks = [...data.weeks].sort(
    (a, b) => new Date(b.week_start).getTime() - new Date(a.week_start).getTime(),
  );

  // Clamp wi in case data changes
  const safeWi = Math.min(wi, weeks.length - 1);
  const week = weeks[safeWi];
  const isCurrentWeek = week.week_start === thisMonday;
  const isFirst = safeWi === 0;
  const isLast = safeWi === weeks.length - 1;

  return (
    <div className="card hof" aria-label="Hall of Fame">
      <div className="hof-head">
        <h3 className="panel-title">
          <span className="hof-trophy"><TrophyIcon /></span>
          Hall of Fame
        </h3>
        <span className="hof-sub eyebrow">₹500 / week</span>
      </div>

      {/* Mutation error — show inline above the nav */}
      {markPaid.isError && (
        <p className="hof__error" role="alert">
          Couldn&apos;t update payout — try again.
        </p>
      )}

      {/* PREV / NEXT navigation */}
      <div className="hof-nav">
        <button
          type="button"
          className="hof-arrow"
          disabled={isFirst}
          onClick={() => setWi((i) => Math.max(0, i - 1))}
          aria-label="More recent week"
        >
          <ChevronLeft />
        </button>

        <div className="hof-nav-label">
          <span className="eyebrow">{weekRange(week.week_start)}</span>
          {isCurrentWeek && <span className="pill live">This week</span>}
        </div>

        <button
          type="button"
          className="hof-arrow"
          disabled={isLast}
          onClick={() => setWi((i) => Math.min(weeks.length - 1, i + 1))}
          aria-label="Earlier week"
        >
          <ChevronRight />
        </button>
      </div>

      {/* Week winners */}
      <div className="hof-week" key={week.week_start}>
        {week.winners.map((win) => {
          const isThisRowPending =
            markPaid.isPending &&
            pendingWeek === week.week_start &&
            pendingUser === win.user_id;

          return (
            <div key={win.user_id} className="hof-winner">
              <span className="hof-medal" aria-hidden="true">
                <TrophyIcon />
              </span>
              <Avatar name={win.name} avatarUrl={win.avatar_url || undefined} size={30} />
              <div className="hof-winner-txt">
                <span className="hof-winner-name">{win.name}</span>
                <span className="hof-winner-pts mono">{win.points} pts · ₹500</span>
              </div>

              {isAdmin ? (
                <button
                  type="button"
                  className={`pay-badge mark${win.prize_paid ? " paid" : ""}${isThisRowPending ? " loading" : ""}`}
                  disabled={isThisRowPending}
                  aria-busy={isThisRowPending ? "true" : undefined}
                  aria-label={
                    win.prize_paid
                      ? `Mark ${win.name}'s prize unpaid`
                      : `Mark ${win.name}'s prize paid`
                  }
                  onClick={() =>
                    markPaid.mutate({
                      week_start: week.week_start,
                      user_id: win.user_id,
                      paid: !win.prize_paid,
                    })
                  }
                  style={win.prize_paid
                    ? { background: "var(--win-soft)", color: "var(--win)" }
                    : undefined}
                >
                  {isThisRowPending ? (
                    "Saving…"
                  ) : win.prize_paid ? (
                    <><CheckIcon size={13} /> Paid</>
                  ) : (
                    "Mark paid"
                  )}
                </button>
              ) : (
                <span className={`pay-badge ${win.prize_paid ? "paid" : "pending"}`}>
                  {win.prize_paid ? <><CheckIcon size={13} /> Paid</> : "Pending"}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Pager count */}
      <div className="hof-pager mono">
        {safeWi + 1} / {weeks.length} weeks
      </div>
    </div>
  );
}
