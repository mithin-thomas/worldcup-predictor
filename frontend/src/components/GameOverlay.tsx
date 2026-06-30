/**
 * GameOverlay.tsx
 * Full-screen modal overlay hosting the GoatGame mini-game.
 * Pattern mirrors HowToPlayModal: focus close button on mount,
 * restore focus on unmount, Escape + backdrop close, body-scroll
 * lock, role="dialog" + aria-modal + aria-labelledby.
 */

import { useEffect, useId, useRef } from "react";
import { GoatGame } from "./GoatGame";

export function GameOverlay({ onClose }: { onClose: () => void }) {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      prev?.focus();
    };
  }, [onClose]);

  return (
    <div
      className="game-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="game-overlay__panel">
        <div className="game-overlay__head">
          <h2 id={titleId} className="game-overlay__title">
            Chased by the GOAT
          </h2>
          <button
            ref={closeRef}
            type="button"
            className="game-overlay__close"
            aria-label="Close game"
            onClick={onClose}
          >
            <CloseIcon />
          </button>
        </div>
        <GoatGame />
      </div>
    </div>
  );
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
