import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { MatchDTO, MatchPredictionDTO } from "../lib/matches";
import { useMatchPredictions } from "../lib/matches";
import { Avatar } from "./Avatar";
import { Flag } from "./Flag";
import { CheckIcon } from "./icons";

// ── Close icon ─────────────────────────────────────────────────────────────
function CloseIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

// ── OthersPicksModal — accessible scrollable modal dialog ──────────────────
// Mirrors HowToPlayModal: focus trap, Escape, backdrop, focus restoration,
// body scroll lock. Data is fetched lazily (only when open).
interface OthersPicksModalProps {
  match: MatchDTO;
  onClose: () => void;
}

function OthersPicksModal({ match, onClose }: OthersPicksModalProps) {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);

  const { data, isLoading, isError } = useMatchPredictions(match.id, true);

  // Map team id → code for penalty winner display
  function penWinnerCode(teamId: number | null): string | null {
    if (teamId === null) return null;
    if (match.home && match.home.id === teamId) return match.home.code;
    if (match.away && match.away.id === teamId) return match.away.code;
    return null;
  }

  // Focus the close button on mount; restore focus on unmount.
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => {
      previouslyFocused?.focus();
    };
  }, []);

  // Prevent body scroll while modal is open.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // Focus trap: cycle Tab/Shift+Tab within the dialog.
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      onClose();
      return;
    }
    if (e.key !== "Tab") return;

    const dialog = e.currentTarget;
    const focusable = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      )
    ).filter((el) => !el.hasAttribute("disabled"));

    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const focused = document.activeElement;

    if (e.shiftKey) {
      if (focused === first) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (focused === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  // Backdrop click closes modal.
  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  const title =
    match.home && match.away
      ? `Others' picks — ${match.home.name} vs ${match.away.name}`
      : "Others' picks";

  return (
    <div
      className="op-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onKeyDown={handleKeyDown}
      onClick={handleBackdropClick}
    >
      <div className="op-dialog">
        {/* Fixed header */}
        <div className="op-dialog-header">
          <h2 id={titleId} className="op-dialog-title">{title}</h2>
          <button
            type="button"
            ref={closeRef}
            className="op-dialog-close"
            aria-label="Close"
            onClick={onClose}
          >
            <CloseIcon />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="op-dialog-body">
          {/* Loading skeleton */}
          {isLoading && (
            <ul className="op-list" aria-label="Loading predictions" aria-busy="true">
              {[0, 1, 2, 3, 4].map((i) => (
                <li key={i} className="op-row op-row--skeleton" aria-hidden="true">
                  <span className="skeleton op-skel-avatar" />
                  <span className="skeleton op-skel-name" />
                  <span className="skeleton op-skel-score" />
                </li>
              ))}
            </ul>
          )}

          {/* Error */}
          {isError && !isLoading && (
            <p className="op-error" role="alert">
              Couldn't load predictions.
            </p>
          )}

          {/* Empty */}
          {!isLoading && !isError && data && data.length === 0 && (
            <p className="op-empty">No predictions for this match.</p>
          )}

          {/* Prediction list */}
          {!isLoading && !isError && data && data.length > 0 && (
            <ul className="op-list" aria-label="Others' predictions">
              {data.map((p: MatchPredictionDTO) => {
                const penCode = penWinnerCode(p.penalty_winner_team_id);
                const scored = p.points !== null;
                const ptsClass =
                  p.points != null
                    ? p.points >= 5
                      ? "win"
                      : p.points > 0
                      ? "ok"
                      : "miss"
                    : null;

                return (
                  <li
                    key={p.user_id}
                    className={`op-row${p.is_me ? " op-row--me" : ""}`}
                  >
                    {/* Avatar */}
                    <Avatar
                      name={p.name}
                      avatarUrl={p.avatar_url}
                      size={28}
                      isMe={p.is_me}
                    />

                    {/* Name */}
                    <span className="op-name">
                      {p.is_me ? `${p.name} ` : p.name}
                      {p.is_me && <span className="you-tag">(You)</span>}
                    </span>

                    {/* Scoreline */}
                    <span className="op-score mono">
                      {p.home_score}–{p.away_score}
                      {penCode && (
                        <span className="op-pen"> · pens: {penCode}</span>
                      )}
                    </span>

                    {/* Points chip — only for FINAL matches */}
                    {scored && ptsClass && (
                      <span
                        className={`pts-chip ${ptsClass} mono`}
                        aria-label={`${p.points ?? 0} points`}
                      >
                        {(p.points ?? 0) > 0 ? "+" : ""}{p.points} pts
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

// ── OthersPicksTrigger — trigger button + lazy modal ─────────────────────
function OthersPicksTrigger({ match }: { match: MatchDTO }) {
  const [open, setOpen] = useState(false);

  // Fetch only when the modal is open. TanStack keeps `data` cached after the
  // modal closes (enabled=false), so the count stays in the label without any
  // extra state — avoids both setState-during-render and setState-in-effect.
  const { data } = useMatchPredictions(match.id, open);

  const label =
    data != null ? `Others' picks (${data.length})` : "Others' picks";

  return (
    <>
      <button
        type="button"
        className="op-toggle"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        <svg
          viewBox="0 0 24 24"
          width="14"
          height="14"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
        <span>{label}</span>
      </button>

      {open &&
        createPortal(
          <OthersPicksModal match={match} onClose={() => setOpen(false)} />,
          document.body,
        )}
    </>
  );
}

// ── PastRow ────────────────────────────────────────────────────────────────
type Props = { match: MatchDTO };

export function PastRow({ match }: Props) {
  const { home, away, home_score, away_score, group, round, prediction, label } = match;

  // TBD past match (shouldn't happen but be safe)
  if (!home || !away) {
    return (
      <article className="past-row match-card" aria-label={label}>
        <span style={{ color: "var(--text-3)", fontSize: 13 }}>{label}</span>
      </article>
    );
  }

  // A locked match may not be scored yet (kicked off but result not ingested).
  // Only show a scoreline + winner emphasis + points once a result exists.
  const scored = home_score != null && away_score != null;
  const hs = home_score ?? 0;
  const as_ = away_score ?? 0;
  const homeWin = scored && hs > as_;
  const awayWin = scored && as_ > hs;
  const tag = group ? `Group ${group}` : round;

  const penBonus = prediction?.penalty_bonus;
  const hasPenBonus = penBonus != null && penBonus > 0;
  const predictionPenTeam =
    prediction?.penalty_winner_team_id === home.id
      ? home
      : prediction?.penalty_winner_team_id === away.id
      ? away
      : null;
  const pts = prediction?.points ?? null;
  const ptsVal = pts ?? 0;
  const hit =
    scored && prediction != null &&
    prediction.home_score === hs && prediction.away_score === as_;

  // Verdict drives the stripe colour + the chip. Server points are authoritative
  // (5 = exact, 3 = right result, 0 = miss per spec §3.3/§5).
  let cls = ""; // "" | win | ok | miss → stripe + chip styling
  let verdict = "Awaiting result";
  if (scored) {
    if (prediction == null) { cls = "miss"; verdict = "No prediction"; }
    else if (ptsVal >= 5) { cls = "win"; verdict = "Exact score"; }
    else if (ptsVal > 0) { cls = "ok"; verdict = "Right result"; }
    else { cls = "miss"; verdict = "Missed"; }
  }
  const verdictCls = scored ? cls : "pending";

  return (
    <article
      className={`past-row match-card ${cls}`.trim()}
      aria-label={
        scored
          ? `${home.name} ${hs}–${as_} ${away.name}, result`
          : `${home.name} versus ${away.name}, awaiting result`
      }
    >
      <header className="mc-head pr-head">
        <span className="eyebrow mc-grp pr-grp">{tag}</span>
        <span className="mc-meta">
          <span className={`pill pr-verdict ${verdictCls}`.trim()}>
            {cls === "win" && (
              <span className="pr-vic">
                <CheckIcon size={12} />
              </span>
            )}
            {verdict}
            {scored && prediction != null && (
              <b className="mono">{ptsVal > 0 ? "+" : ""}{ptsVal}</b>
            )}
          </span>
        </span>
      </header>

      <div className="mc-teams pr-main">
        <div className={`mc-team home pr-team${homeWin ? " w" : ""}`}>
          <Flag code={home.code} size={46} />
          <div className="mc-team-txt">
            <span className="mc-team-name">{home.name}</span>
            <span className="mono mc-team-code">{home.code}</span>
          </div>
        </div>

        <div className="mc-vs pr-score">
          {scored ? (
            <>
              <span className="mc-score mono">{hs}</span>
              <span className="mc-dash pr-dash">–</span>
              <span className="mc-score mono">{as_}</span>
            </>
          ) : (
            <span className="mc-score mono muted">vs</span>
          )}
        </div>

        <div className={`mc-team away pr-team${awayWin ? " w" : ""}`}>
          <div className="mc-team-txt">
            <span className="mc-team-name">{away.name}</span>
            <span className="mono mc-team-code">{away.code}</span>
          </div>
          <Flag code={away.code} size={46} />
        </div>
      </div>

      <footer className="mc-predict pr-foot">
        <div className="pr-pick-summary">
          <span className="pr-foot-lbl">Your prediction</span>
          {prediction != null ? (
            <span className="pr-compare">
              <b className={`pr-mypick mono${hit ? " hit" : ""}`}>
                {prediction.home_score}–{prediction.away_score}
              </b>
              {scored && (
                <>
                  <span className="pr-arrow" aria-hidden="true">→</span>
                  <b className="pr-final mono">{hs}–{as_}</b>
                </>
              )}
              {predictionPenTeam && (
                <span className="pr-pen-pick" aria-label={`Penalty winner ${predictionPenTeam.name}`}>
                  <span className="pr-pen-pick__label">Pens</span>
                  <Flag code={predictionPenTeam.code} size={18} radius={3} />
                  <span className="mono pr-pen-pick__code">{predictionPenTeam.code}</span>
                </span>
              )}
              {hasPenBonus && <span className="pr-pen">+{penBonus} PEN</span>}
            </span>
          ) : (
            <span className="pr-foot-lbl">No prediction</span>
          )}
        </div>

        <div className="mc-action pr-action">
          <OthersPicksTrigger match={match} />
        </div>
      </footer>
    </article>
  );
}
