/**
 * Seg — segmented control used in Leaderboard and elsewhere.
 * Matches the design's .seg / .seg-sm / .seg-btn / .seg-bg / .seg-lbl pattern.
 *
 * Uses a radiogroup pattern (role="radiogroup" + role="radio" + aria-checked)
 * so that mutually-exclusive options are conveyed correctly to assistive tech.
 * Tab focuses the group; Space/Enter activates the focused option.
 */

type SegOption = { value: string; label: string } | string;

type SegProps = {
  options: SegOption[];
  value: string;
  onChange: (v: string) => void;
  size?: "md" | "sm";
  label?: string;
};

export function Seg({ options, value, onChange, size = "md", label = "Options" }: SegProps) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={`seg${size === "sm" ? " seg-sm" : ""}`}
    >
      {options.map((o) => {
        const v = typeof o === "string" ? o : o.value;
        const l = typeof o === "string" ? o : o.label;
        const on = value === v;
        return (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={on}
            className={`seg-btn${on ? " on" : ""}`}
            onClick={() => onChange(v)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onChange(v);
              }
            }}
          >
            {on && <span className="seg-bg" aria-hidden="true" />}
            <span className="seg-lbl">{l}</span>
          </button>
        );
      })}
    </div>
  );
}
