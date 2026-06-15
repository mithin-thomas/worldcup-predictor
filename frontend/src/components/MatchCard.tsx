import { useState, useEffect } from "react";
import type { MatchDTO, TeamDTO } from "../lib/matches";
import { usePutPrediction, PredictionLockedError } from "../lib/matches";
import { flagClass } from "../lib/flags";
import { Countdown } from "./Countdown";

// ── IST time formatter ─────────────────────────────────────────────────────
const istTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
    hour12: true,
  });

// ── Flag component ─────────────────────────────────────────────────────────
function Flag({ code, size = 46 }: { code?: string; size?: number }) {
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
    <span className="flag flag--tbd" style={{ width: w, height: h, fontSize: 12 }}
      aria-hidden="true">?</span>
  );
}

// ── Inline SVG icons ───────────────────────────────────────────────────────
function ClockIcon() {
  return (
    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor"
      strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor"
      strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor"
      strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12.5 10 17l9-10" />
    </svg>
  );
}

function MinusIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"
      strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
      <path d="M5 12h14" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"
      strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

// ── Pill stepper (design: ±, circle buttons, pill container) ────────────────
function PillStepper({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  disabled: boolean;
}) {
  return (
    <div className={`stepper-pill${disabled ? " off" : ""}`}>
      <button
        type="button"
        className="step-btn"
        aria-label={`Decrease ${label} score`}
        disabled={disabled || value <= 0}
        onClick={() => onChange(Math.max(0, value - 1))}
      >
        <MinusIcon />
      </button>
      <span className="step-val mono" aria-label={`${label} score: ${value}`}>{value}</span>
      <button
        type="button"
        className="step-btn"
        aria-label={`Increase ${label} score`}
        disabled={disabled || value >= 99}
        onClick={() => onChange(Math.min(99, value + 1))}
      >
        <PlusIcon />
      </button>
    </div>
  );
}

// ── Match group/round tag ──────────────────────────────────────────────────
function stageTag(match: MatchDTO): string {
  if (match.group) return `Group ${match.group}`;
  return match.round;
}

// ── MatchCard: full predictor card for an upcoming match ───────────────────
type Props = { match: MatchDTO };

export function MatchCard({ match }: Props) {
  const { home, away, kickoff_ist, label, venue } = match;
  const decided = home !== null && away !== null;

  // If TBD, render read-only placeholder (no predictor)
  if (!decided) {
    return (
      <article className="match-card" aria-label={label}>
        <header className="mc-head">
          <span className="eyebrow mc-grp">
            {stageTag(match)}
            {venue ? ` · ${venue.city}` : ""}
          </span>
          <span className="mc-meta">
            <span className="mono mc-time">{istTime(kickoff_ist)} IST</span>
          </span>
        </header>
        <div className="mc-teams" style={{ justifyContent: "center", margin: "16px 0 4px" }}>
          <span style={{ color: "var(--text-3)", gridColumn: "1 / -1", textAlign: "center" }}>
            {label}
          </span>
        </div>
      </article>
    );
  }

  return <MatchCardEditor match={match} home={home as TeamDTO} away={away as TeamDTO} />;
}

// ── Inner editor (only rendered when teams are known) ─────────────────────
function MatchCardEditor({
  match,
  home,
  away,
}: {
  match: MatchDTO;
  home: TeamDTO;
  away: TeamDTO;
}) {
  const { kickoff_utc, kickoff_ist, status, locked: serverLocked, stage, venue, group, round, prediction } = match;

  const [h, setH] = useState(prediction?.home_score ?? 0);
  const [a, setA] = useState(prediction?.away_score ?? 0);
  const [pen, setPen] = useState<number | null>(prediction?.penalty_winner_team_id ?? null);
  const [saved, setSaved] = useState(false);

  const mut = usePutPrediction(match.id);
  const locked409 = mut.error instanceof PredictionLockedError;
  const locked = serverLocked || locked409;

  const isDraw = h === a;
  const showPenalty = stage === "knockout" && isDraw;

  // Fix: use useEffect to clear the "Saved" flash so the timeout is cleaned up on unmount
  useEffect(() => {
    if (!saved) return;
    const id = setTimeout(() => setSaved(false), 1_600);
    return () => clearTimeout(id);
  }, [saved]);

  // Dirty logic: new pick always saveable (incl. 0-0); existing only when changed.
  const dirty =
    !prediction ||
    h !== prediction.home_score ||
    a !== prediction.away_score ||
    (showPenalty ? pen : null) !== (prediction.penalty_winner_team_id ?? null);

  const hasPick = prediction != null;
  const tag = group ? `Group ${group}` : round;

  const onSave = () => {
    mut.mutate(
      {
        home_score: h,
        away_score: a,
        penalty_winner_team_id: showPenalty ? pen : null,
      },
      {
        onSuccess: () => {
          setSaved(true);
          // The useEffect on `saved` handles clearing after 1600 ms (with unmount cleanup)
        },
      },
    );
  };

  return (
    <article
      className={`match-card${hasPick ? " has-pick" : ""}`}
      aria-label={`${home.name} versus ${away.name}`}
    >
      {/* ── Head ──────────────────────────────────────────────────────────── */}
      <header className="mc-head">
        <span className="eyebrow mc-grp">
          {tag}
          {venue ? ` · ${venue.city}` : ""}
        </span>
        <span className="mc-meta">
          <span className="mono mc-time">{istTime(kickoff_ist)} IST</span>
          {locked ? (
            <span className="pill lock"><LockIcon /> Locked</span>
          ) : status === "live" ? (
            <span className="pill live">Live</span>
          ) : (
            <span className="mc-count mono">
              <ClockIcon />
              <Countdown to={kickoff_utc} />
            </span>
          )}
        </span>
      </header>

      {/* ── Teams + live scoreline ─────────────────────────────────────────── */}
      <div className="mc-teams">
        <div className="mc-team home">
          <Flag code={home.code} size={46} />
          <div className="mc-team-txt">
            <span className="mc-team-name">{home.name}</span>
            <span className="mono mc-team-code">{home.code}</span>
          </div>
        </div>

        <div className="mc-vs">
          <span className="mc-score mono">{h}</span>
          <span className="mc-dash">–</span>
          <span className="mc-score mono">{a}</span>
        </div>

        <div className="mc-team away">
          <div className="mc-team-txt">
            <span className="mc-team-name">{away.name}</span>
            <span className="mono mc-team-code">{away.code}</span>
          </div>
          <Flag code={away.code} size={46} />
        </div>
      </div>

      {/* ── Predictor row ─────────────────────────────────────────────────── */}
      <div className="mc-predict">
        {locked ? (
          /* Read-only locked state */
          <span className="mc-pick-ro">
            Pick locked · {prediction ? `${prediction.home_score}–${prediction.away_score}` : "—"}
          </span>
        ) : (
          /* Active stepper row */
          <div className="mc-steps">
            <PillStepper
              label={home.name}
              value={h}
              onChange={(v) => {
                setH(v);
                // Clear pen when the new scoreline is no longer a draw
                if (v !== a) setPen(null);
              }}
              disabled={mut.isPending}
            />
            <span className="mc-steps-vs">your scoreline</span>
            <PillStepper
              label={away.name}
              value={a}
              onChange={(v) => {
                setA(v);
                // Clear pen when the new scoreline is no longer a draw
                if (h !== v) setPen(null);
              }}
              disabled={mut.isPending}
            />
          </div>
        )}

        {!locked && (
          <div className="mc-action">
            {saved ? (
              <span className="mc-saved"><CheckIcon /> Saved</span>
            ) : (
              <button
                type="button"
                className={`btn-save${dirty ? "" : " ghost"}`}
                onClick={onSave}
                disabled={!dirty || mut.isPending}
                aria-label={hasPick ? "Update prediction" : "Save prediction"}
              >
                {mut.isPending
                  ? "Saving…"
                  : hasPick
                    ? "Update pick"
                    : "Save prediction"}
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── Shootout winner (knockout draw only) ──────────────────────────── */}
      {!locked && showPenalty && (
        <div className="match__penalty" role="group" aria-label="Shootout winner">
          <span className="match__penalty-label">Shootout winner</span>
          <div className="segmented">
            <button
              type="button"
              className={`segmented__opt${pen === home.id ? " is-active" : ""}`}
              aria-pressed={pen === home.id}
              onClick={() => setPen(home.id)}
              disabled={mut.isPending}
            >
              {home.code}
            </button>
            <button
              type="button"
              className={`segmented__opt${pen === away.id ? " is-active" : ""}`}
              aria-pressed={pen === away.id}
              onClick={() => setPen(away.id)}
              disabled={mut.isPending}
            >
              {away.code}
            </button>
          </div>
        </div>
      )}

      {/* ── 409 lock error ────────────────────────────────────────────────── */}
      {locked409 && (
        <p className="match__editor-error" role="alert">
          This match locked at kickoff.
        </p>
      )}
    </article>
  );
}
