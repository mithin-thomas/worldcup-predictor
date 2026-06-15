import type { MatchDTO } from "../lib/matches";
import { flagClass } from "../lib/flags";

// ── Flag ───────────────────────────────────────────────────────────────────
function Flag({ code, size = 30 }: { code?: string; size?: number }) {
  const cls = flagClass(code);
  const w = Math.round(size);
  const h = Math.round(size * 0.7);
  if (cls) {
    return (
      <span className={`flag ${cls}`} style={{ width: w, height: h }}
        aria-hidden="true" />
    );
  }
  return (
    <span className="flag flag--tbd" style={{ width: w, height: h, fontSize: 10 }}
      aria-hidden="true">?</span>
  );
}

// ── Points chip ────────────────────────────────────────────────────────────
// 5=win/gold, 3=ok/blue, 0=miss/muted, null=not scored yet
function PtsChip({ points }: { points: number | null }) {
  if (points === null) {
    // Not yet scored — show a neutral dash
    return <span className="pts-chip miss mono">—</span>;
  }
  const cls = points >= 5 ? "win" : points >= 2 ? "ok" : "miss";
  return (
    <span className={`pts-chip ${cls} mono`} aria-label={`${points} points`}>
      {points > 0 ? "+" : ""}{points} pts
    </span>
  );
}

// ── PastRow ────────────────────────────────────────────────────────────────
type Props = { match: MatchDTO };

export function PastRow({ match }: Props) {
  const { home, away, home_score, away_score, group, round, prediction, label } = match;

  // TBD past match (shouldn't happen but be safe)
  if (!home || !away) {
    return (
      <article className="past-row" aria-label={label}>
        <span style={{ color: "var(--text-3)", fontSize: 13 }}>{label}</span>
      </article>
    );
  }

  const hs = home_score ?? 0;
  const as_ = away_score ?? 0;
  const homeWin = hs > as_;
  const awayWin = as_ > hs;
  const tag = group ? `Group ${group}` : round;

  const penBonus = prediction?.penalty_bonus;
  const hasPenBonus = penBonus != null && penBonus > 0;

  return (
    <article
      className="past-row"
      aria-label={`${home.name} ${hs}–${as_} ${away.name}, result`}
    >
      {/* ── Score layout ────────────────────────────────────────────────── */}
      <div className="pr-main">
        {/* Home team (right-aligned, winner gets full text color) */}
        <div className={`pr-team home${homeWin ? " w" : ""}`}>
          <span className="pr-name">{home.name}</span>
          <Flag code={home.code} size={30} />
        </div>

        {/* Final score */}
        <div className="pr-score">
          <span className="mono">{hs}</span>
          <span className="pr-dash">–</span>
          <span className="mono">{as_}</span>
        </div>

        {/* Away team */}
        <div className={`pr-team away${awayWin ? " w" : ""}`}>
          <Flag code={away.code} size={30} />
          <span className="pr-name">{away.name}</span>
        </div>
      </div>

      {/* ── Footer: group tag, your pick, points chip ────────────────────── */}
      <div className="pr-foot">
        <span className="pr-grp eyebrow">{tag}</span>

        {prediction ? (
          <span className="pr-pick">
            Your pick{" "}
            <b className="mono">
              {prediction.home_score}–{prediction.away_score}
            </b>
            {hasPenBonus && (
              <span style={{ color: "var(--text-3)", fontSize: 11, marginLeft: 4 }}>
                +{penBonus} PEN
              </span>
            )}
          </span>
        ) : (
          <span className="pr-pick muted">No prediction</span>
        )}

        {prediction ? (
          <PtsChip points={prediction.points} />
        ) : (
          <span className="pts-chip miss mono">+0 pts</span>
        )}
      </div>
    </article>
  );
}
