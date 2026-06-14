import { useWinners, useMarkWinnerPaid } from "../lib/winners";
import { useMe } from "../lib/auth";

function weekLabel(weekStart: string): string {
  return new Date(`${weekStart}T00:00:00+05:30`).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    timeZone: "Asia/Kolkata",
  });
}

export function HallOfFame() {
  const { data, isLoading, isError } = useWinners();
  const me = useMe();
  const isAdmin = me.data?.role === "admin";
  const markPaid = useMarkWinnerPaid();

  return (
    <section className="hof" aria-label="Hall of Fame">
      <h2 className="hof__title">Hall of Fame</h2>

      {isLoading ? (
        <div className="hof__skeleton" aria-hidden="true">
          <div className="skeleton skeleton--text hof__skeleton-line" />
          <div className="skeleton skeleton--text hof__skeleton-line" />
          <div className="skeleton skeleton--text hof__skeleton-line hof__skeleton-line--short" />
        </div>
      ) : isError ? (
        <p className="hof__empty" role="alert">Couldn&apos;t load past winners.</p>
      ) : !data || data.weeks.length === 0 ? (
        <p className="hof__empty">No champions yet — the first weekly winner is crowned Monday.</p>
      ) : (
        <ul className="hof__weeks">
          {data.weeks.map((wk) => (
            <li key={wk.week_start} className="hof__week">
              <p className="hof__weeklabel">Week of {weekLabel(wk.week_start)}</p>
              <ul className="hof__winners">
                {wk.winners.map((win) => (
                  <li key={win.user_id} className="hof__winner">
                    <span className="hof__trophy" aria-hidden="true">🏆</span>
                    <span className="hof__name">{win.name}</span>
                    <span className="hof__pts mono" aria-label={`${win.points} points`}>
                      {win.points}
                    </span>
                    <span className="hof__prize mono">₹500</span>
                    {isAdmin ? (
                      <button
                        type="button"
                        className={`hof__paidbtn${win.prize_paid ? " is-paid" : ""}`}
                        disabled={markPaid.isPending}
                        aria-label={
                          win.prize_paid
                            ? `Mark ${win.name}'s card unpaid`
                            : `Mark ${win.name}'s card paid`
                        }
                        onClick={() =>
                          markPaid.mutate({
                            week_start: wk.week_start,
                            user_id: win.user_id,
                            paid: !win.prize_paid,
                          })
                        }
                      >
                        {win.prize_paid ? "Paid ✓" : "Mark paid"}
                      </button>
                    ) : (
                      <span className={`hof__paidbadge${win.prize_paid ? " is-paid" : ""}`}>
                        {win.prize_paid ? "Paid ✓" : "Unpaid"}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
