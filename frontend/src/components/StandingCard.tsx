/**
 * StandingCard — "Your standing" hero sidebar card.
 *
 * Shows the current user's overall rank, points, weekly rank, and a gap bar
 * vs the #1 player. All data from real hooks — no fabricated streak/spark.
 *
 * Data:
 *   useMe() for name
 *   useLeaderboard("overall", 1) for me.rank, me.points, rows[0].points (leader)
 *   useLeaderboard("week", 1) for me.rank (weekly rank)
 */

import type { CSSProperties } from "react";
import { useMe } from "../lib/auth";
import { useLeaderboard } from "../lib/leaderboard";
import football from "../assets/football.png";

// Optional stadium photo behind the hero. Drop `standing-bg.png` into
// frontend/public/ to light it up; absent, the FIFA gradient/pitch shows.
const photoStyle = { "--standing-photo": "url('/standing-bg.png')" } as CSSProperties;

export function StandingCard() {
  const meQuery = useMe();
  const overall = useLeaderboard("overall", 1);
  const weekly = useLeaderboard("week", 1);

  const isLoading = meQuery.isLoading || overall.isLoading || weekly.isLoading;

  // --- Skeleton ---
  if (isLoading) {
    return (
      <div className="standing" aria-label="Your standing" aria-busy="true">
        <div className="standing-top">
          <span className="eyebrow">Your standing</span>
        </div>
        <div className="standing-main" style={{ gap: 16 }}>
          <div className="skeleton" style={{ width: 80, height: 52, borderRadius: "var(--r-md)" }} />
          <div style={{ display: "flex", flexDirection: "column", gap: 8, flex: 1 }}>
            <div className="skeleton skeleton--text skeleton--medium" />
            <div className="skeleton skeleton--text skeleton--long" />
          </div>
        </div>
        <div className="skeleton" style={{ height: 26, borderRadius: "var(--r-pill)", width: "100%" }} />
      </div>
    );
  }

  const me = meQuery.data;
  const overallData = overall.data;
  const weeklyData = weekly.data;

  // No-rank teaching state: user hasn't entered rankings yet
  const myOverall = overallData?.me;
  const myWeeklyRank = weeklyData?.me?.rank ?? weeklyData?.rows.find((r) => r.is_me)?.rank;

  if (!me || !myOverall) {
    return (
      <div className="standing" aria-label="Your standing">
        <div className="standing-bg" style={photoStyle} aria-hidden="true" />
        <div className="standing-top">
          <span className="eyebrow">Your standing</span>
        </div>
        <div style={{ padding: "16px 0", color: "rgba(255,255,255,0.82)", fontSize: 13, lineHeight: 1.6 }}>
          Make your first prediction to enter the rankings.
        </div>
      </div>
    );
  }

  // Compute gap bar
  const leaderPoints = overallData.rows[0]?.points ?? 0;
  const myPoints = myOverall.points;
  const myRank = myOverall.rank;
  const isLeading = myRank === 1;
  const gap = Math.max(0, leaderPoints - myPoints);
  const barPct = isLeading || leaderPoints === 0
    ? 100
    : Math.min(100, Math.max(0, Math.round((myPoints / leaderPoints) * 100)));

  return (
    <div className="standing" aria-label="Your standing">
      <div className="standing-bg" style={photoStyle} aria-hidden="true" />
      <div className="standing-top">
        <span className="eyebrow">Your standing</span>
        {/* streak slot intentionally empty — no streak data in API */}
      </div>

      <div className="standing-main">
        <div className="standing-rank" aria-label={`Rank ${myRank}`}>
          <span className="sr-hash">#</span>
          <span className="mono">{myRank}</span>
        </div>
        <div className="standing-info">
          <div className="standing-name">{me.name}</div>
          <div className="standing-stats">
            <span className="mono">{myPoints}</span> pts overall
            {myWeeklyRank != null && (
              <>
                <span className="dotsep" aria-hidden="true" />
                <span className="mono">#{myWeeklyRank}</span> this week
              </>
            )}
          </div>
        </div>
      </div>

      <div className="standing-bar" role="progressbar" aria-valuenow={barPct} aria-valuemin={0} aria-valuemax={100}
        aria-label={isLeading ? "Leading the overall standings" : `${gap} points behind #1`}>
        <div className="standing-bar-fill" style={{ width: `${barPct}%` }}>
          <span className="standing-ball" aria-hidden="true">
            <img src={football} alt="" width={20} height={20} />
          </span>
        </div>
        <span className="standing-gap mono">
          {isLeading ? "Leading" : `${gap} pts behind #1`}
        </span>
      </div>
    </div>
  );
}
