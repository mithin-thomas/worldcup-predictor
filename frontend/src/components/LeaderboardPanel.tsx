/**
 * LeaderboardPanel — top-5 preview with a "View all N players" button
 * that opens the full leaderboard in a scrollable modal.
 *
 * Card layout: .card.lb with .lb-head (title + Seg toggle) and .lb-list of
 * .lb-row rows (rank chip, avatar, name+You tag, points).
 *
 * - Shows at most 5 rows from the first page.
 * - The "View all" button is only shown when data.total > 5.
 * - The off-page "Your rank: N · P pts" line is shown when the current
 *   user is NOT in the top 5 (uses data.me).
 * - The full modal (LeaderboardModal) opens on the same period the panel
 *   currently shows.
 */

import { useState } from "react";
import { useLeaderboard } from "../lib/leaderboard";
import { Avatar } from "./Avatar";
import { Seg } from "./Seg";
import { LeaderboardModal } from "./LeaderboardModal";

type Period = "week" | "overall";

const SEG_OPTIONS = [
  { value: "overall", label: "Overall" },
  { value: "week",    label: "Weekly" },
];

const TOP_N = 5;

export function LeaderboardPanel() {
  const [period, setPeriod] = useState<Period>("overall");
  const [modalOpen, setModalOpen] = useState(false);

  // Always fetch page 1 for the panel — we only show the top 5.
  const { data, isLoading, isError } = useLeaderboard(period, 1);

  const swap = (p: Period) => {
    setPeriod(p);
  };

  // Slice to at most 5 rows for the panel preview.
  const previewRows = data ? data.rows.slice(0, TOP_N) : [];
  const showViewAll = data ? data.total > TOP_N : false;

  return (
    <>
      <section className="card lb" aria-label="Leaderboard">
        <div className="lb-head">
          <h3 className="panel-title">Leaderboard</h3>
          <Seg
            size="sm"
            options={SEG_OPTIONS}
            value={period}
            onChange={(v) => swap(v as Period)}
          />
        </div>

        {isLoading ? (
          <div aria-hidden="true" style={{ display: "flex", flexDirection: "column", gap: 8, padding: "4px 0" }}>
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="skeleton" style={{ height: 46, borderRadius: "var(--r-sm)", width: "100%" }} />
            ))}
          </div>
        ) : isError ? (
          <p className="lb__empty" role="alert">Couldn&apos;t load the leaderboard.</p>
        ) : !data || data.rows.length === 0 ? (
          <p className="lb__empty">
            {period === "week"
              ? "No scores this week yet — points appear after matches kick off."
              : "No ranked players yet — make your first prediction."}
          </p>
        ) : (
          <>
            <ol className="lb-list">
              {previewRows.map((r) => {
                const isPodium = period === "overall" && r.rank <= 3;
                return (
                  <li
                    key={r.user_id}
                    className={`lb-row${isPodium ? " podium" : ""}${r.is_me ? " you" : ""}`}
                    {...(r.is_me ? { "data-me": "" } : {})}
                  >
                    <span className={`lb-rank${r.rank <= 3 ? ` r${r.rank}` : ""} mono`} aria-label={`Rank ${r.rank}`}>
                      {r.rank}
                    </span>
                    <Avatar name={r.name} avatarUrl={r.avatar_url || undefined} size={28} isMe={r.is_me} />
                    <span className="lb-name">
                      {r.name}
                      {r.is_me && <span className="you-tag">(You)</span>}
                      {period === "week" && r.is_winner && (
                        <span className="lb__badge" aria-label="weekly winner">★</span>
                      )}
                    </span>
                    <span className="lb-pts mono" aria-label={`${r.points} points`}>
                      {r.points}
                    </span>
                  </li>
                );
              })}
            </ol>

            {/* Off-page "Your rank" line — shown when current user is not in top 5 */}
            {data.me && !previewRows.some((r) => r.is_me) ? (
              <p className="lb__me mono">Your rank: {data.me.rank} · {data.me.points} pts</p>
            ) : null}

            {/* "View all N players" button — only when total > 5 */}
            {showViewAll && (
              <button
                type="button"
                className="lb-view-all"
                onClick={() => setModalOpen(true)}
                aria-haspopup="dialog"
              >
                View all {data.total} players
              </button>
            )}
          </>
        )}
      </section>

      {/* Full leaderboard modal — mounted lazily when open */}
      {modalOpen && (
        <LeaderboardModal
          initialPeriod={period}
          onClose={() => setModalOpen(false)}
        />
      )}
    </>
  );
}
