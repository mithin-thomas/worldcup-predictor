import type { MatchDTO, TeamDTO } from "../lib/matches";
import { Countdown } from "./Countdown";

type Props = {
  match: MatchDTO;
};

function formatISTTime(kickoffIst: string): string {
  // kickoff_ist is already an IST ISO string e.g. "2026-06-12T00:30:00+05:30"
  return new Date(kickoffIst).toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
    hour12: true,
  });
}

function teamLabel(team: TeamDTO): string {
  return team.code?.trim() ? team.code : team.name;
}

export function MatchRow({ match }: Props) {
  const {
    home,
    away,
    venue,
    group,
    kickoff_utc,
    kickoff_ist,
    status,
    locked,
    home_score,
    away_score,
    label,
    round,
  } = match;

  const isFinal = status === "final";
  const isLive = status === "live";
  const decided = home !== null && away !== null;

  // Header: group letter for group matches, else the round name; plus venue city.
  const stageTag = group ? `Group ${group}` : round;
  const ariaLabel = decided ? `${home!.name} vs ${away!.name}` : label;

  return (
    <article className="match-row" aria-label={ariaLabel}>
      <div className="match-row__round">
        {stageTag}
        {venue ? <span className="match-row__venue"> · {venue.city}</span> : null}
      </div>

      <div className="match-row__body">
        {decided ? (
          <>
            <div className="match-row__team match-row__team--home">
              <span className="match-row__code">{teamLabel(home!)}</span>
            </div>

            <div className="match-row__centre">
              {isFinal && home_score !== null && away_score !== null ? (
                <span className="match-row__score mono" aria-label={`Score: ${home_score} to ${away_score}`}>
                  {home_score}
                  <span className="match-row__score-sep" aria-hidden="true"> – </span>
                  {away_score}
                </span>
              ) : isLive ? (
                <span className="match-row__live-badge" aria-label="Match is live">
                  LIVE
                </span>
              ) : (
                <span className="match-row__vs mono" aria-hidden="true">vs</span>
              )}
            </div>

            <div className="match-row__team match-row__team--away">
              <span className="match-row__code">{teamLabel(away!)}</span>
            </div>
          </>
        ) : (
          // Knockout placeholder — teams not yet decided (e.g. "W73 vs W75").
          <div className="match-row__placeholder muted">{label}</div>
        )}
      </div>

      <div className="match-row__footer">
        <span className="match-row__time mono" aria-label={`Kickoff at ${formatISTTime(kickoff_ist)} IST`}>
          {formatISTTime(kickoff_ist)} IST
        </span>

        {locked ? (
          <span className="match-row__lock-badge" aria-label="Predictions locked">
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            Locked
          </span>
        ) : (
          <Countdown to={kickoff_utc} />
        )}
      </div>
    </article>
  );
}
