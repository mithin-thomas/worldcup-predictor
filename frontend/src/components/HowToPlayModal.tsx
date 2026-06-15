/**
 * HowToPlayModal.tsx
 * Accessible "How to Play" dialog explaining SayScore rules.
 * Pattern mirrors ConfirmDialog in Admin.tsx: focus trap, Escape,
 * backdrop click, focus restoration, role=dialog + aria-modal.
 */

import { useEffect, useId, useRef } from "react";

interface HowToPlayModalProps {
  onClose: () => void;
}

export function HowToPlayModal({ onClose }: HowToPlayModalProps) {
  const titleId = useId();
  const descId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

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

  return (
    <div
      className="htp-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descId}
      onKeyDown={handleKeyDown}
      onClick={handleBackdropClick}
    >
      <div className="htp-dialog">
        {/* Header — fixed, not scrolled */}
        <div className="htp-header">
          <h2 id={titleId} className="htp-title">How to play</h2>
          <button
            type="button"
            ref={closeRef}
            className="htp-close"
            aria-label="Close"
            onClick={onClose}
          >
            <CloseIcon />
          </button>
        </div>

        {/* Scrollable body */}
        <div
          ref={scrollRef}
          className="htp-body"
          id={descId}
          tabIndex={0}
          aria-label="Rules content"
        >
          {/* Predict every match */}
          <section className="htp-section">
            <h3 className="htp-section-title">Predict every match</h3>
            <ul className="htp-list">
              <li>
                Predict the scoreline for every World Cup match. You can edit your
                pick any time until kickoff. At kickoff it locks (the server enforces
                this, so a late edit is rejected).
              </li>
              <li>
                Each match opens for predictions 3 days before kickoff — you can set
                or change your pick any time in that window, until it locks at kickoff.
              </li>
              <li>
                Other players' predictions stay hidden until a match locks at kickoff,
                then they're revealed. Keeps it fair.
              </li>
            </ul>
          </section>

          {/* Points per match */}
          <section className="htp-section">
            <h3 className="htp-section-title">Points per match</h3>
            <ul className="htp-points-list">
              <li className="htp-points-row">
                <span className="htp-pts-label">Exact score (both numbers right)</span>
                <span className="htp-pts-val mono htp-pts-exact">5</span>
              </li>
              <li className="htp-points-row">
                <span className="htp-pts-label">
                  Correct result (right winner, or you correctly called a draw)
                  but wrong score
                </span>
                <span className="htp-pts-val mono htp-pts-ok">3</span>
              </li>
              <li className="htp-points-row">
                <span className="htp-pts-label">Wrong</span>
                <span className="htp-pts-val mono htp-pts-miss">0</span>
              </li>
              <li className="htp-points-row htp-points-row--bonus">
                <span className="htp-pts-label">
                  <strong>Knockout penalty bonus:</strong> in a knockout match that
                  goes to a penalty shootout, if you predicted a draw for the 90/extra-time
                  result (and that pick earned points) AND you picked the correct shootout
                  winner, you get +1 on top.
                </span>
                <span className="htp-pts-val mono htp-pts-bonus">+1</span>
              </li>
            </ul>
          </section>

          {/* Tournament Bonus */}
          <section className="htp-section htp-section--gold">
            <h3 className="htp-section-title htp-section-title--gold">
              Tournament Bonus
              <span className="htp-bonus-cap mono">up to 100 pts</span>
            </h3>
            <p className="htp-section-note">
              Predict the big honours once, before the bonus lock
              (28 June 2026, end of day IST):
            </p>
            <ul className="htp-bonus-list">
              <li className="htp-bonus-row">
                <span className="htp-bonus-label">World Cup Winner</span>
                <span className="htp-bonus-pts mono">30</span>
              </li>
              <li className="htp-bonus-row">
                <span className="htp-bonus-label">Runner-Up</span>
                <span className="htp-bonus-pts mono">20</span>
              </li>
              <li className="htp-bonus-row">
                <span className="htp-bonus-label">Golden Ball</span>
                <span className="htp-bonus-pts mono">10</span>
              </li>
              <li className="htp-bonus-row">
                <span className="htp-bonus-label">Golden Boot</span>
                <span className="htp-bonus-pts mono">10</span>
              </li>
              <li className="htp-bonus-row">
                <span className="htp-bonus-label">Golden Glove</span>
                <span className="htp-bonus-pts mono">10</span>
              </li>
              <li className="htp-bonus-row">
                <span className="htp-bonus-label">Young Player Award</span>
                <span className="htp-bonus-pts mono">10</span>
              </li>
              <li className="htp-bonus-row">
                <span className="htp-bonus-label">Fair Play Award</span>
                <span className="htp-bonus-pts mono">10</span>
              </li>
            </ul>
            <p className="htp-section-note htp-section-note--muted">
              These are scored once, after the tournament ends, and added to your total.
            </p>
          </section>

          {/* Leaderboards */}
          <section className="htp-section">
            <h3 className="htp-section-title">Leaderboards and prizes</h3>
            <div className="htp-lb-block">
              <p className="htp-lb-label">Weekly</p>
              <p className="htp-lb-body">
                Each week sums the points from matches that kick off Mon–Sun (IST).
                Highest total wins the week. Ties stand: every co-winner is paid in full.
                Prize: <strong>₹500 Amazon gift card</strong> per weekly winner.
              </p>
            </div>
            <div className="htp-lb-block">
              <p className="htp-lb-label">Overall</p>
              <p className="htp-lb-body">
                All your match points plus bonus points combined. Ties for the final
                standings are broken in order by: total points, then most exact-score
                (<span className="mono">5</span>-pt) hits, then most correct-result
                (<span className="mono">3</span>-pt) hits, then most correct bonus picks.
                Prizes: 1st <strong>₹5,000</strong>, 2nd <strong>₹2,500</strong>.
              </p>
            </div>
            <div className="htp-lb-block">
              <p className="htp-lb-label">Hall of Fame</p>
              <p className="htp-lb-body">
                Past weekly champions are kept on show (newest week first) with their
                points and payout status.
              </p>
            </div>
          </section>

          {/* Footer line */}
          <p className="htp-footer-line">
            Good luck. Lock your picks before kickoff.
          </p>
        </div>
      </div>
    </div>
  );
}

// Inline close icon — consistent with the outline icon set in icons.tsx.
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
