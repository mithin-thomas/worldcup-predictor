import { useEffect, useRef, useState } from "react";
import { usePlayerSearch, type PlayerOption } from "../lib/bonus";

// ── Shared searchable player combobox ────────────────────────────────────────
//
// Extracted from routes/Bonus.tsx so both the user Bonus screen and the Admin
// Bonus-outcomes tab share one implementation. Keyboard: arrow/enter/escape.
// ARIA: role=combobox, aria-expanded, listbox/options, aria-activedescendant.

export interface PlayerComboboxProps {
  /** Unique key used to scope listbox IDs (e.g. category key or a unique string) */
  comboboxKey: string;
  /** Human-readable label for the aria-label on the search input */
  ariaLabel: string;
  /** Whether the control is interactive */
  disabled: boolean;
  /** The currently saved ref_id (used to determine placeholder text) */
  currentRefId: number | undefined;
  /** Server-provided label for the saved pick; shown below the input when set */
  currentLabel: string | undefined;
  /** Called with the selected player when the user picks one */
  onSelect: (player: PlayerOption) => void;
}

export function PlayerCombobox({
  comboboxKey,
  ariaLabel,
  disabled,
  currentRefId,
  currentLabel,
  onSelect,
}: PlayerComboboxProps) {
  const [query, setQuery] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data: results = [], isFetching } = usePlayerSearch(debouncedQ);

  // Debounce input → query
  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setDebouncedQ(query);
      setActiveIdx(-1);
    }, 300);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [query]);

  const listboxId = `combobox-list-${comboboxKey}`;

  const selectOption = (opt: PlayerOption) => {
    onSelect(opt);
    setQuery("");
    setDebouncedQ("");
    setOpen(false);
    setActiveIdx(-1);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" && !open) {
      e.preventDefault();
      setOpen(true);
      setActiveIdx(0);
      return;
    }
    if (!open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && activeIdx >= 0) {
      e.preventDefault();
      if (results[activeIdx]) selectOption(results[activeIdx]);
    } else if (e.key === "Escape") {
      setOpen(false);
      setActiveIdx(-1);
    }
  };

  const placeholder =
    currentRefId != null ? (currentLabel ?? "Selected") : "Search players…";

  return (
    <div className="bonus-combobox" data-testid={`player-combobox-${comboboxKey}`}>
      <div className="bonus-combobox__field">
        <input
          type="text"
          role="combobox"
          aria-label={ariaLabel}
          aria-expanded={open}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={
            activeIdx >= 0 ? `${listboxId}-opt-${activeIdx}` : undefined
          }
          className="bonus-combobox__input"
          placeholder={placeholder}
          value={query}
          disabled={disabled}
          autoComplete="off"
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(e.target.value.length > 0);
          }}
          onKeyDown={handleKeyDown}
          onBlur={() => {
            setTimeout(() => setOpen(false), 150);
          }}
        />
        {/* Clear search text only — does not remove the saved pick */}
        {query && !disabled && (
          <button
            type="button"
            className="bonus-combobox__clear"
            aria-label="Clear search"
            tabIndex={-1}
            onMouseDown={(e) => {
              e.preventDefault();
              setQuery("");
              setDebouncedQ("");
              setOpen(false);
            }}
          >
            &times;
          </button>
        )}
        {isFetching && <span className="bonus-combobox__spinner" aria-hidden="true" />}
      </div>

      {open && results.length > 0 && (
        <ul
          id={listboxId}
          role="listbox"
          className="bonus-combobox__list"
          aria-label="Player results"
        >
          {results.map((opt, i) => (
            <li
              key={opt.id}
              id={`${listboxId}-opt-${i}`}
              role="option"
              aria-selected={i === activeIdx}
              className={`bonus-combobox__option${i === activeIdx ? " is-active" : ""}`}
              onMouseDown={(e) => {
                e.preventDefault();
                selectOption(opt);
              }}
            >
              <span className="bonus-combobox__name">{opt.name}</span>
              <span className="bonus-combobox__meta">
                {opt.team_code}
                {opt.position ? ` · ${opt.position}` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}

      {open && debouncedQ.length >= 2 && results.length === 0 && !isFetching && (
        <div className="bonus-combobox__empty" role="status" aria-live="polite">
          No players found for &ldquo;{debouncedQ}&rdquo;
        </div>
      )}

      {/* Show server-sourced label for the saved pick — survives reload */}
      {currentRefId != null && !query && currentLabel && (
        <div className="bonus-combobox__selected" aria-live="polite">
          <span className="bonus-combobox__selected-label">{currentLabel}</span>
        </div>
      )}
    </div>
  );
}
