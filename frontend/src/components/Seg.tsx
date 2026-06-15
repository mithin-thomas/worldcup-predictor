/**
 * Seg — segmented control used in Leaderboard and elsewhere.
 * Matches the design's .seg / .seg-sm / .seg-btn / .seg-bg / .seg-lbl pattern.
 */

type SegOption = { value: string; label: string } | string;

type SegProps = {
  options: SegOption[];
  value: string;
  onChange: (v: string) => void;
  size?: "md" | "sm";
};

export function Seg({ options, value, onChange, size = "md" }: SegProps) {
  return (
    <div className={`seg${size === "sm" ? " seg-sm" : ""}`}>
      {options.map((o) => {
        const v = typeof o === "string" ? o : o.value;
        const l = typeof o === "string" ? o : o.label;
        const on = value === v;
        return (
          <button
            key={v}
            type="button"
            className={`seg-btn${on ? " on" : ""}`}
            onClick={() => onChange(v)}
            aria-pressed={on}
          >
            {on && <span className="seg-bg" aria-hidden="true" />}
            <span className="seg-lbl">{l}</span>
          </button>
        );
      })}
    </div>
  );
}
