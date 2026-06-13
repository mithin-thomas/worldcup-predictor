import { useEffect, useState } from "react";

type Props = {
  to: string; // ISO UTC string
};

function getRemainingSeconds(isoUtc: string): number {
  return Math.floor((new Date(isoUtc).getTime() - Date.now()) / 1000);
}

function formatCountdown(totalSeconds: number): string {
  if (totalSeconds <= 0) return "Kicked off";
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  if (h > 0) return `${h}:${pad(m)}:${pad(s)}`;
  return `${pad(m)}:${pad(s)}`;
}

export function Countdown({ to }: Props) {
  const [remaining, setRemaining] = useState(() => getRemainingSeconds(to));

  useEffect(() => {
    if (remaining <= 0) return;

    // Respect prefers-reduced-motion: still update but less frequently
    const prefersReduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const interval = prefersReduced ? 10_000 : 1_000;

    const id = setInterval(() => {
      setRemaining(getRemainingSeconds(to));
    }, interval);

    return () => clearInterval(id);
  }, [to, remaining]);

  const label = formatCountdown(remaining);
  const isKickedOff = remaining <= 0;

  return (
    <span
      className={`countdown mono${isKickedOff ? " countdown--elapsed" : ""}`}
      aria-label={isKickedOff ? "Match has kicked off" : `Kicks off in ${label}`}
    >
      {label}
    </span>
  );
}
