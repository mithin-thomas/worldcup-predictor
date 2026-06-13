import type { MatchDTO } from "../lib/matches";
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

function teamLabel(team: MatchDTO["home"]): string {
  return team.code?.trim() ? team.code : team.name;
}

export function MatchRow({ match }: Props) {
  const {
    home,
    away,
    kickoff_utc,
    kickoff_ist,
    status,
    locked,
    home_score,
    away_score,
    stage,
    round,
  } = match;

  const isFinal = status === "final";
  const isLive = status === "live";

  return (
    <article className="match-row" aria-label={`${home.name} vs ${away.name}`}>
      {/* Round label */}
      <div className="match-row__round" aria-label={`Round: ${round}`}>
        {stage === "knockout" ? round : round.replace(/^Group [A-Z] - /, "R")}
      </div>

      {/* Teams + Score */}
      <div className="match-row__body">
        <div className="match-row__team match-row__team--home">
          {home.logo_url && (
            <img
              className="match-row__logo"
              src={home.logo_url}
              alt=""
              aria-hidden="true"
              width={24}
              height={24}
            />
          )}
          <span className="match-row__code">{teamLabel(home)}</span>
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
          <span className="match-row__code">{teamLabel(away)}</span>
          {away.logo_url && (
            <img
              className="match-row__logo"
              src={away.logo_url}
              alt=""
              aria-hidden="true"
              width={24}
              height={24}
            />
          )}
        </div>
      </div>

      {/* Kickoff time + lock/countdown */}
      <div className="match-row__footer">
        <span className="match-row__time mono" aria-label={`Kickoff at ${formatISTTime(kickoff_ist)} IST`}>
          {formatISTTime(kickoff_ist)}
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
