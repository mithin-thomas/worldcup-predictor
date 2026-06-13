import type { MatchDTO, TeamDTO } from "../lib/matches";
import { flagClass } from "../lib/flags";
import { Countdown } from "./Countdown";

type Props = { match: MatchDTO };

const istTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
    hour12: true,
  });

function Flag({ code }: { code?: string }) {
  const cls = flagClass(code);
  if (cls) return <span className={`flag ${cls}`} aria-hidden="true" />;
  return (
    <span className="flag flag--tbd" aria-hidden="true">
      ?
    </span>
  );
}

function TeamSide({ team, side }: { team: TeamDTO; side: "home" | "away" }) {
  return (
    <div className={`team team--${side}`}>
      <Flag code={team.code} />
      <span className="team__label">
        <span className="team__name">{team.name}</span>
        <span className="team__code mono">{team.code}</span>
      </span>
    </div>
  );
}

function LockIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

export function MatchRow({ match }: Props) {
  const {
    home, away, venue, group, round, kickoff_utc, kickoff_ist,
    status, locked, home_score, away_score, label,
  } = match;

  const decided = home !== null && away !== null;
  const isFinal = status === "final";
  const stageTag = group ? `Group ${group}` : round;

  return (
    <article className="match" aria-label={decided ? `${home!.name} versus ${away!.name}` : label}>
      <div className="match__meta">
        <span className="match__tag">
          {stageTag}
          {venue ? <span className="match__venue"> · {venue.city}</span> : null}
        </span>
        <span className="match__when">
          <time className="mono">{istTime(kickoff_ist)} IST</time>
          {locked ? (
            <span className="match__lock"><LockIcon /> Locked</span>
          ) : (
            <span className="match__countdown"><Countdown to={kickoff_utc} /></span>
          )}
        </span>
      </div>

      {decided ? (
        <div className="match__teams">
          <TeamSide team={home!} side="home" />
          <div className="match__center">
            {isFinal && home_score !== null && away_score !== null ? (
              <span className="match__score mono" aria-label={`${home_score} to ${away_score}`}>
                {home_score}<span className="match__dash">–</span>{away_score}
              </span>
            ) : (
              <span className="match__vs">vs</span>
            )}
          </div>
          <TeamSide team={away!} side="away" />
        </div>
      ) : (
        <div className="match__teams match__teams--tbd">
          <span className="match__placeholder">{label}</span>
        </div>
      )}
    </article>
  );
}
