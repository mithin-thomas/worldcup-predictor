import { useState } from "react";
import { useLeaderboard } from "../lib/leaderboard";

type Period = "week" | "overall";

export function LeaderboardPanel() {
  const [period, setPeriod] = useState<Period>("overall");
  const [page, setPage] = useState(1);
  const { data, isLoading, isError } = useLeaderboard(period, page);

  const swap = (p: Period) => {
    setPeriod(p);
    setPage(1);
  };

  return (
    <section className="lb" aria-label="Leaderboard">
      <div className="lb__tabs" aria-label="Leaderboard period">
        <button type="button" aria-pressed={period === "overall"}
          className={`lb__tab ${period === "overall" ? "is-active" : ""}`} onClick={() => swap("overall")}>
          Overall
        </button>
        <button type="button" aria-pressed={period === "week"}
          className={`lb__tab ${period === "week" ? "is-active" : ""}`} onClick={() => swap("week")}>
          Weekly
        </button>
      </div>

      {isLoading ? (
        <div className="lb__skeleton" aria-hidden="true">
          <div className="skeleton skeleton--text" /><div className="skeleton skeleton--text" /><div className="skeleton skeleton--text" />
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
          {period === "week" && data.week ? (
            <p className="lb__week">
              Week of {new Date(`${data.week}T00:00:00+05:30`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" })}
            </p>
          ) : null}
          <ol className="lb__list">
            {data.rows.map((r) => (
              <li
                key={r.user_id}
                className={`lb__row${r.rank === 1 ? " lb__row--top" : ""}${r.is_me ? " is-me" : ""}`}
                {...(r.is_me ? { "data-me": "" } : {})}
              >
                <span className="lb__rank mono">{r.rank}</span>
                <span className="lb__name">
                  {r.name}
                  {period === "week" && r.is_winner ? <span className="lb__badge" aria-label="weekly winner">★</span> : null}
                </span>
                <span className="lb__pts mono" aria-label={`${r.points} points`}>{r.points}</span>
              </li>
            ))}
          </ol>
          {data.me && !data.rows.some((r) => r.is_me) ? (
            <p className="lb__me mono">Your rank: {data.me.rank} · {data.me.points} pts</p>
          ) : null}
          {data.total > data.page_size ? (
            <div className="lb__pager">
              <button type="button" className="btn-ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} aria-label="Previous page">‹</button>
              <span className="lb__pageinfo mono">{page} / {Math.ceil(data.total / data.page_size)}</span>
              <button type="button" className="btn-ghost" disabled={page >= Math.ceil(data.total / data.page_size)} onClick={() => setPage((p) => p + 1)} aria-label="Next page">›</button>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
