/**
 * LeaderboardPanel — reskinned to the SayOne design system.
 *
 * Card layout: .card.lb with .lb-head (title + Seg toggle) and .lb-list of
 * .lb-row rows (rank chip, avatar, name+You tag, points).
 *
 * Preserves all wiring: useLeaderboard(period, page), period swap resets page,
 * weekly ★ winner badge, off-page "Your rank: N", pagination, skeleton/error/empty.
 */

import { useState } from "react";
import { useLeaderboard } from "../lib/leaderboard";
import { Avatar } from "./Avatar";
import { Seg } from "./Seg";

type Period = "week" | "overall";

const SEG_OPTIONS = [
  { value: "overall", label: "Overall" },
  { value: "week",    label: "Weekly" },
];

export function LeaderboardPanel() {
  const [period, setPeriod] = useState<Period>("overall");
  const [page, setPage] = useState(1);
  const { data, isLoading, isError } = useLeaderboard(period, page);

  const swap = (p: Period) => {
    setPeriod(p);
    setPage(1);
  };

  const totalPages = data ? Math.ceil(data.total / data.page_size) : 1;

  return (
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
            {data.rows.map((r) => {
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

          {/* Off-page "Your rank" line */}
          {data.me && !data.rows.some((r) => r.is_me) ? (
            <p className="lb__me mono">Your rank: {data.me.rank} · {data.me.points} pts</p>
          ) : null}

          {/* Pagination */}
          {data.total > data.page_size ? (
            <div className="lb__pager">
              <button
                type="button"
                className="btn-ghost"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
                aria-label="Previous page"
              >
                ‹
              </button>
              <span className="lb__pageinfo mono">{page} / {totalPages}</span>
              <button
                type="button"
                className="btn-ghost"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
                aria-label="Next page"
              >
                ›
              </button>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
