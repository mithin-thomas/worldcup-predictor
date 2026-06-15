/**
 * Flag.tsx — shared flag image component.
 *
 * Renders a CSS-sprite flag or a "?" placeholder for unknown/TBD teams.
 * aria-hidden="true" on all outputs — flag is decorative; the team name
 * provides the accessible label on the parent element.
 */
import { flagClass } from "../lib/flags";

interface FlagProps {
  code?: string;
  /** Visual width in px; height is derived at 0.7 × width. Default 46. */
  size?: number;
  /** Border-radius override. Default 4 for small flags, 5 for medium+. */
  radius?: number;
}

export function Flag({ code, size = 46, radius }: FlagProps) {
  const cls = flagClass(code);
  const w = Math.round(size);
  const h = Math.round(size * 0.7);
  const r = radius ?? (size <= 24 ? 4 : 5);

  if (cls) {
    return (
      <span
        className={`flag ${cls}`}
        style={{ width: w, height: h, borderRadius: r }}
        aria-hidden="true"
      />
    );
  }
  return (
    <span
      className="flag flag--tbd"
      style={{ width: w, height: h, fontSize: Math.max(10, Math.round(size * 0.26)) }}
      aria-hidden="true"
    >
      ?
    </span>
  );
}
