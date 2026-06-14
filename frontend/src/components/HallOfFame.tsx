import { useWinners, useMarkWinnerPaid } from "../lib/winners";
import { useMe } from "../lib/auth";

// weekRange renders the IST Mon–Sun span for a week_start (YYYY-MM-DD, the IST
// calendar Monday). E.g. "25–31 May 2026", or "29 Jun – 5 Jul 2026" across a
// month boundary. Times are converted at the edge to IST, never shown as raw UTC.
function weekRange(weekStart: string): string {
  const start = new Date(`${weekStart}T00:00:00+05:30`);
  const end = new Date(start.getTime() + 6 * 86_400_000); // Sunday = Monday + 6d
  const part = (d: Date, opts: Intl.DateTimeFormatOptions) =>
    d.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", ...opts });
  const startMonth = part(start, { month: "short" });
  const endMonth = part(end, { month: "short" });
  const year = part(end, { year: "numeric" });
  return startMonth === endMonth
    ? `${part(start, { day: "numeric" })}–${part(end, { day: "numeric" })} ${endMonth} ${year}`
    : `${part(start, { day: "numeric", month: "short" })} – ${part(end, { day: "numeric", month: "short" })} ${year}`;
}

export function HallOfFame() {
  const { data, isLoading, isError } = useWinners();
  const me = useMe();
  const isAdmin = me.data?.role === "admin";
  const markPaid = useMarkWinnerPaid();

  // Identify the in-flight row by both week_start AND user_id to handle recurrence
  const pendingWeek = markPaid.variables?.week_start;
  const pendingUser = markPaid.variables?.user_id;

  return (
    <section className="hof" aria-label="Hall of Fame">
      <h2 className="hof__title">Hall of Fame</h2>

      {/* FIX 1: surface mark-paid mutation errors inline */}
      {markPaid.isError && (
        <p className="hof__error" role="alert">
          Couldn&apos;t update payout — try again.
        </p>
      )}

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
              <p className="hof__weeklabel">{weekRange(wk.week_start)}</p>
              <ul className="hof__winners">
                {wk.winners.map((win) => {
                  // FIX 2: per-row loading — only the in-flight row shows Saving…
                  const isThisRowPending =
                    markPaid.isPending &&
                    pendingWeek === wk.week_start &&
                    pendingUser === win.user_id;

                  return (
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
                          className={`hof__paidbtn${win.prize_paid ? " is-paid" : ""}${isThisRowPending ? " is-loading" : ""}`}
                          disabled={isThisRowPending}
                          aria-busy={isThisRowPending ? "true" : undefined}
                          aria-label={
                            win.prize_paid
                              ? `Mark ${win.name}'s prize unpaid`
                              : `Mark ${win.name}'s prize paid`
                          }
                          onClick={() =>
                            markPaid.mutate({
                              week_start: wk.week_start,
                              user_id: win.user_id,
                              paid: !win.prize_paid,
                            })
                          }
                        >
                          {isThisRowPending ? "Saving…" : win.prize_paid ? "Paid ✓" : "Mark paid"}
                        </button>
                      ) : (
                        <span className={`hof__paidbadge${win.prize_paid ? " is-paid" : ""}`}>
                          {win.prize_paid ? "Paid ✓" : "Unpaid"}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
