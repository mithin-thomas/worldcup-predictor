/**
 * LeaderboardModal — full leaderboard in a scrollable, accessible modal.
 *
 * A11y contract mirrors HowToPlayModal and OthersPicksModal:
 *   role=dialog, aria-modal, aria-labelledby, focus trap (Tab/Shift+Tab),
 *   Escape, backdrop close, focus restoration, body scroll lock.
 *
 * The modal opens on the same period the panel currently shows.
 * Period toggle + Prev/Next pagination live inside the modal.
 * Data is fetched lazily — the query only mounts when the modal is open.
 */

import { useEffect, useId, useRef, useState } from "react";
import { useLeaderboard } from "../lib/leaderboard";
import { Avatar } from "./Avatar";
import { Seg } from "./Seg";

type Period = "week" | "overall";

const SEG_OPTIONS = [
  { value: "overall", label: "Overall" },
  { value: "week",    label: "Weekly" },
];

interface LeaderboardModalProps {
  initialPeriod: Period;
  onClose: () => void;
}

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

export function LeaderboardModal({ initialPeriod, onClose }: LeaderboardModalProps) {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);

  const [period, setPeriod] = useState<Period>(initialPeriod);
  const [page, setPage] = useState(1);

  const { data, isLoading, isError } = useLeaderboard(period, page);

  const totalPages = data ? Math.ceil(data.total / data.page_size) : 1;

  // Reset page to 1 when period changes.
  const swap = (p: Period) => {
    setPeriod(p);
    setPage(1);
  };

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
      className="lbm-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onKeyDown={handleKeyDown}
      onClick={handleBackdropClick}
    >
      <div className="lbm-dialog">
        {/* Fixed header: title + period toggle + close */}
        <div className="lbm-header">
          <h2 id={titleId} className="lbm-title">Leaderboard</h2>
          <Seg
            size="sm"
            options={SEG_OPTIONS}
            value={period}
            onChange={(v) => swap(v as Period)}
          />
          <button
            type="button"
            ref={closeRef}
            className="lbm-close"
            aria-label="Close leaderboard"
            onClick={onClose}
          >
            <CloseIcon />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="lbm-body">
          {/* Loading skeleton */}
          {isLoading && (
            <div aria-hidden="true" className="lbm-skeletons">
              {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
                <div
                  key={i}
                  className="skeleton"
                  style={{ height: 44, borderRadius: "var(--r-sm)", width: "100%" }}
                />
              ))}
            </div>
          )}

          {/* Error */}
          {isError && !isLoading && (
            <p className="lb__empty" role="alert">
              Couldn&apos;t load the leaderboard.
            </p>
          )}

          {/* Empty */}
          {!isLoading && !isError && data && data.rows.length === 0 && (
            <p className="lb__empty">
              {period === "week"
                ? "No scores this week yet — points appear after matches kick off."
                : "No ranked players yet — make your first prediction."}
            </p>
          )}

          {/* Full ranked list */}
          {!isLoading && !isError && data && data.rows.length > 0 && (
            <>
              <ol className="lb-list">
                {data.rows.map((r) => {
                  const isPodium = period === "overall" && r.rank <= 3;
                  return (
                    <li
                      key={r.user_id}
                      className={`lb-row${isPodium ? " podium" : ""}${r.is_me ? " you" : ""}`}
                      {...(r.is_me ? { "data-me": "" } : {})}
                    >
                      <span
                        className={`lb-rank${r.rank <= 3 ? ` r${r.rank}` : ""} mono`}
                        aria-label={`Rank ${r.rank}`}
                      >
                        {r.rank}
                      </span>
                      <Avatar
                        name={r.name}
                        avatarUrl={r.avatar_url || undefined}
                        size={28}
                        isMe={r.is_me}
                      />
                      <span className="lb-name">
                        {r.name}
                        {r.is_me && <span className="you-tag">(You)</span>}
                        {period === "week" && r.is_winner && (
                          <span className="lb__badge" aria-label="weekly winner">
                            ★
                          </span>
                        )}
                      </span>
                      <span
                        className="lb-pts mono"
                        aria-label={`${r.points} points`}
                      >
                        {r.points}
                      </span>
                    </li>
                  );
                })}
              </ol>

              {/* Pagination — Prev/Next */}
              {totalPages > 1 && (
                <div className="lb__pager">
                  <button
                    type="button"
                    className="btn-ghost"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => p - 1)}
                    aria-label="Previous page"
                  >
                    ‹
                  </button>
                  <span className="lb__pageinfo mono">
                    {page} / {totalPages}
                  </span>
                  <button
                    type="button"
                    className="btn-ghost"
                    disabled={page >= totalPages}
                    onClick={() => setPage((p) => p + 1)}
                    aria-label="Next page"
                  >
                    ›
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
