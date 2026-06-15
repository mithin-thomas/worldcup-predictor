import { useEffect, useId, useRef, useState } from "react";
import type { MatchDTO, MatchPredictionDTO } from "../lib/matches";
import { useMatchPredictions } from "../lib/matches";
import { Avatar } from "./Avatar";
import { Flag } from "./Flag";

// ── Points chip ────────────────────────────────────────────────────────────
// 5=win/gold, 3=ok/blue, 0=miss/muted, null=not scored yet
function PtsChip({ points }: { points: number | null }) {
  if (points === null) {
    // Not yet scored — show a neutral dash
    return <span className="pts-chip miss mono">—</span>;
  }
  const cls = points >= 5 ? "win" : points > 0 ? "ok" : "miss";
  return (
    <span className={`pts-chip ${cls} mono`} aria-label={`${points} points`}>
      {points > 0 ? "+" : ""}{points} pts
    </span>
  );
}

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

      {open && (
        <OthersPicksModal match={match} onClose={() => setOpen(false)} />
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
      <article className="past-row" aria-label={label}>
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

  return (
    <article
      className="past-row"
      aria-label={
        scored
          ? `${home.name} ${hs}–${as_} ${away.name}, result`
          : `${home.name} versus ${away.name}, awaiting result`
      }
    >
      {/* ── Top row: score + footer ──────────────────────────────────────── */}
      <div className="pr-top">
        {/* Score layout */}
        <div className="pr-main">
          {/* Home team (right-aligned, winner gets full text color) */}
          <div className={`pr-team home${homeWin ? " w" : ""}`}>
            <span className="pr-name">{home.name}</span>
            <Flag code={home.code} size={30} />
          </div>

          {/* Final score, or "vs" while awaiting the result */}
          <div className="pr-score">
            {scored ? (
              <>
                <span className="mono">{hs}</span>
                <span className="pr-dash">–</span>
                <span className="mono">{as_}</span>
              </>
            ) : (
              <span className="mono muted">vs</span>
            )}
          </div>

          {/* Away team */}
          <div className={`pr-team away${awayWin ? " w" : ""}`}>
            <Flag code={away.code} size={30} />
            <span className="pr-name">{away.name}</span>
          </div>
        </div>

        {/* ── Footer: group tag, your pick, points chip ────────────────── */}
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

          {!scored ? (
            <span className="pr-pick muted">Awaiting result</span>
          ) : prediction ? (
            <PtsChip points={prediction.points} />
          ) : (
            <span className="pts-chip miss mono">+0 pts</span>
          )}
        </div>
      </div>

      {/* ── Others' picks (spec §4 — only shown on locked matches) ─────────── */}
      <OthersPicksTrigger match={match} />
    </article>
  );
}
