import { useState } from "react";
import type { MatchDTO, TeamDTO } from "../lib/matches";
import { flagClass } from "../lib/flags";
import { usePutPrediction, PredictionLockedError } from "../lib/matches";
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

function LockIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

function Stepper({
  label, value, onChange, disabled,
}: { label: string; value: number; onChange: (v: number) => void; disabled?: boolean }) {
  return (
    <div className="stepper">
      <button
        type="button" className="stepper__btn" aria-label={`Decrease ${label}`}
        disabled={disabled || value <= 0} onClick={() => onChange(Math.max(0, value - 1))}
      >−</button>
      <span className="stepper__value mono" aria-label={`${label} score`}>{value}</span>
      <button
        type="button" className="stepper__btn" aria-label={`Increase ${label}`}
        disabled={disabled || value >= 99} onClick={() => onChange(Math.min(99, value + 1))}
      >+</button>
    </div>
  );
}

function Editor({ match }: { match: MatchDTO }) {
  const home = match.home as TeamDTO;
  const away = match.away as TeamDTO;
  const [h, setH] = useState(match.prediction?.home_score ?? 0);
  const [a, setA] = useState(match.prediction?.away_score ?? 0);
  const [pen, setPen] = useState<number | null>(match.prediction?.penalty_winner_team_id ?? null);
  const mut = usePutPrediction(match.id);

  const isDraw = h === a;
  const showPenalty = match.stage === "knockout" && isDraw;

  const dirty =
    h !== (match.prediction?.home_score ?? 0) ||
    a !== (match.prediction?.away_score ?? 0) ||
    (showPenalty ? pen : null) !== (match.prediction?.penalty_winner_team_id ?? null);

  const onSave = () => {
    mut.mutate({
      home_score: h,
      away_score: a,
      penalty_winner_team_id: showPenalty ? pen : null,
    });
  };

  const locked = mut.error instanceof PredictionLockedError;

  return (
    <div className="match__editor" role="group" aria-label={`Your prediction for ${home.name} versus ${away.name}`}>
      <div className="match__editor-row">
        <span className="match__editor-team">{home.name}</span>
        <Stepper label={home.name} value={h} onChange={setH} disabled={mut.isPending || locked} />
      </div>
      <div className="match__editor-row">
        <span className="match__editor-team">{away.name}</span>
        <Stepper label={away.name} value={a} onChange={setA} disabled={mut.isPending || locked} />
      </div>

      {showPenalty && (
        <div className="match__penalty" role="group" aria-label="Shootout winner">
          <span className="match__penalty-label">Shootout winner</span>
          <div className="segmented">
            <button
              type="button" className={`segmented__opt ${pen === home.id ? "is-active" : ""}`}
              aria-pressed={pen === home.id} onClick={() => setPen(home.id)} disabled={mut.isPending || locked}
            >{home.code}</button>
            <button
              type="button" className={`segmented__opt ${pen === away.id ? "is-active" : ""}`}
              aria-pressed={pen === away.id} onClick={() => setPen(away.id)} disabled={mut.isPending || locked}
            >{away.code}</button>
          </div>
        </div>
      )}

      <div className="match__editor-actions">
        {locked && <span className="match__editor-error" role="alert">This match locked at kickoff.</span>}
        <button
          type="button" className="btn-brand"
          disabled={!dirty || mut.isPending || locked} onClick={onSave}
          aria-label="Save prediction"
        >
          {mut.isPending ? "Saving…" : "Save prediction"}
        </button>
      </div>
    </div>
  );
}

export function MatchRow({ match }: Props) {
  const { home, away, venue, group, round, kickoff_utc, kickoff_ist, status, locked, home_score, away_score, label, prediction } = match;
  const [open, setOpen] = useState(false);

  const decided = home !== null && away !== null;
  const isFinal = status === "final";
  const stageTag = group ? `Group ${group}` : round;
  const editable = decided && !locked;

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
          <div className="team team--home">
            <Flag code={home!.code} />
            <span className="team__label"><span className="team__name">{home!.name}</span><span className="team__code mono">{home!.code}</span></span>
          </div>
          <div className="match__center">
            {isFinal && home_score !== null && away_score !== null ? (
              <span className="match__score mono" aria-label={`${home_score} to ${away_score}`}>
                {home_score}<span className="match__dash">–</span>{away_score}
              </span>
            ) : (
              <span className="match__vs">vs</span>
            )}
          </div>
          <div className="team team--away">
            <Flag code={away!.code} />
            <span className="team__label"><span className="team__name">{away!.name}</span><span className="team__code mono">{away!.code}</span></span>
          </div>
        </div>
      ) : (
        <div className="match__teams match__teams--tbd">
          <span className="match__placeholder">{label}</span>
        </div>
      )}

      {decided && (
        <div className="match__predict">
          {prediction ? (
            <span className="match__pick mono">Your pick: {prediction.home_score}–{prediction.away_score}</span>
          ) : (
            !locked && <span className="match__pick match__pick--empty">No prediction yet</span>
          )}
          {editable && (
            <button
              type="button" className="match__predict-toggle"
              aria-expanded={open} onClick={() => setOpen((v) => !v)}
              aria-label={prediction ? "Edit prediction" : "Predict score"}
            >
              {prediction ? "Edit" : "Predict"}
            </button>
          )}
        </div>
      )}

      {editable && open && <Editor match={match} />}
    </article>
  );
}
