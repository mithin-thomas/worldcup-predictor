import { useEffect, useRef, useState } from "react";
import {
  CATEGORIES,
  useBonus,
  useTeams,
  usePlayerSearch,
  useSaveBonus,
  type BonusPick,
  type PlayerOption,
} from "../lib/bonus";

// ── IST countdown to lock_at ─────────────────────────────────────────────────
function useCountdown(lockAt: string | undefined): string {
  const [display, setDisplay] = useState("");

  useEffect(() => {
    if (!lockAt) return;

    const tick = () => {
      const diff = new Date(lockAt).getTime() - Date.now();
      if (diff <= 0) {
        setDisplay("Locked");
        return;
      }
      const d = Math.floor(diff / 86_400_000);
      const h = Math.floor((diff % 86_400_000) / 3_600_000);
      const m = Math.floor((diff % 3_600_000) / 60_000);
      const s = Math.floor((diff % 60_000) / 1_000);
      setDisplay(
        d > 0
          ? `${d}d ${h.toString().padStart(2, "0")}h ${m.toString().padStart(2, "0")}m`
          : `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`,
      );
    };

    tick();
    const id = window.setInterval(tick, 1_000);
    return () => window.clearInterval(id);
  }, [lockAt]);

  return display;
}

// ── Format lock_at in IST for display ───────────────────────────────────────
function formatLockIST(lockAt: string): string {
  return new Date(lockAt).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ── Player combobox (hand-rolled, keyboard-accessible) ───────────────────────
interface PlayerComboboxProps {
  categoryKey: string;
  categoryLabel: string;
  disabled: boolean;
  currentRefId: number | undefined;
  /** Server-provided label (survives reload); falls back to optimistic on fresh pick */
  currentLabel: string | undefined;
  onSelect: (id: number, label: string) => void;
}

function PlayerCombobox({
  categoryKey,
  categoryLabel,
  disabled,
  currentRefId,
  currentLabel,
  onSelect,
}: PlayerComboboxProps) {
  const [query, setQuery] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
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

  const listboxId = `combobox-list-${categoryKey}`;

  const selectOption = (opt: PlayerOption) => {
    onSelect(opt.id, `${opt.name} · ${opt.team_code}`);
    setQuery("");
    setDebouncedQ("");
    setOpen(false);
    setActiveIdx(-1);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // ArrowDown must open the listbox when closed (FIX 3)
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

  const displayValue = query;
  const placeholder =
    currentRefId != null ? (currentLabel ?? "Selected") : "Search players…";
  // aria-label for accessible name (FIX 3)
  const inputAriaLabel = `Search players for ${categoryLabel}`;

  return (
    <div className="bonus-combobox" data-testid={`player-combobox-${categoryKey}`}>
      <div className="bonus-combobox__field">
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-label={inputAriaLabel}
          aria-expanded={open}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={
            activeIdx >= 0 ? `${listboxId}-opt-${activeIdx}` : undefined
          }
          className="bonus-combobox__input"
          placeholder={placeholder}
          value={displayValue}
          disabled={disabled}
          autoComplete="off"
          onChange={(e) => {
            setQuery(e.target.value);
            if (e.target.value) {
              setOpen(true);
            } else {
              setOpen(false);
            }
          }}
          onKeyDown={handleKeyDown}
          onBlur={() => {
            // slight delay so click on option registers first
            setTimeout(() => setOpen(false), 150);
          }}
        />
        {/* Clear SEARCH TEXT only — does not remove the saved pick (FIX 2) */}
        {query && !disabled && (
          <button
            type="button"
            className="bonus-combobox__clear"
            aria-label="Clear search"
            tabIndex={-1}
            onMouseDown={(e) => {
              e.preventDefault(); // keep focus on input
              setQuery("");
              setDebouncedQ("");
              setOpen(false);
            }}
          >
            ×
          </button>
        )}
        {isFetching && <span className="bonus-combobox__spinner" aria-hidden="true" />}
      </div>

      {open && results.length > 0 && (
        <ul
          ref={listRef}
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
                e.preventDefault(); // prevent blur before click
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

      {/* Show server-sourced label for the saved pick (FIX 1 — survives reload) */}
      {currentRefId != null && !query && currentLabel && (
        <div className="bonus-combobox__selected" aria-live="polite">
          <span className="bonus-combobox__selected-label">{currentLabel}</span>
        </div>
      )}
    </div>
  );
}

// ── Main Bonus screen ─────────────────────────────────────────────────────────
export function Bonus() {
  const { data: bonus, isLoading, isError } = useBonus();
  const { data: teams = [], isLoading: teamsLoading } = useTeams();
  const saveMutation = useSaveBonus();

  const countdown = useCountdown(bonus?.lock_at);
  const locked = bonus?.locked ?? false;

  // Map picks by category for quick lookup
  const pickMap = new Map<string, BonusPick>(
    (bonus?.picks ?? []).map((p) => [p.category, p]),
  );

  // Optimistic label for player awards on a FRESH pick (before server refetch).
  // After onSuccess the query cache is updated with the server label, so this
  // local state only fills the brief gap between mutation and refetch.
  const [optimisticLabels, setOptimisticLabels] = useState<Record<string, string>>({});

  const handleTeamChange = (categoryKey: string, refId: number) => {
    saveMutation.mutate([{ category: categoryKey, ref_id: refId }]);
  };

  const handlePlayerSelect = (categoryKey: string, refId: number, label: string) => {
    // Keep optimistic label so the combobox doesn't go blank mid-flight
    setOptimisticLabels((prev) => ({ ...prev, [categoryKey]: label }));
    saveMutation.mutate([{ category: categoryKey, ref_id: refId }], {
      onSuccess: () => {
        // Server label is now in cache; clear the optimistic override
        setOptimisticLabels((prev) => {
          const next = { ...prev };
          delete next[categoryKey];
          return next;
        });
      },
    });
  };

  // ── Skeletons ───────────────────────────────────────────────────────────────
  if (isLoading || teamsLoading) {
    return (
      <section className="bonus" aria-label="Tournament Bonus Picks" aria-busy="true">
        <div className="bonus__header">
          <h2 className="bonus__title">Tournament Bonus</h2>
          <div className="skeleton skeleton--text bonus__skeleton-countdown" aria-hidden="true" />
        </div>
        <div className="bonus__list">
          {CATEGORIES.map((cat) => (
            <div key={cat.key} className="bonus-row bonus-row--skeleton" aria-hidden="true">
              <div className="skeleton skeleton--text bonus-row__skeleton-label" />
              <div className="skeleton skeleton--text bonus-row__skeleton-ctrl" />
            </div>
          ))}
        </div>
      </section>
    );
  }

  // ── Load error ──────────────────────────────────────────────────────────────
  if (isError) {
    return (
      <section className="bonus" aria-label="Tournament Bonus Picks">
        <div className="bonus__header">
          <h2 className="bonus__title">Tournament Bonus</h2>
        </div>
        <p className="bonus__load-error" role="alert">
          Couldn&apos;t load bonus picks. Please refresh and try again.
        </p>
      </section>
    );
  }

  const hasPicks = (bonus?.picks?.length ?? 0) > 0;

  return (
    <section className="bonus" aria-label="Tournament Bonus Picks">
      {/* ── Header: title + lock status ─────────────────────────────────── */}
      <div className="bonus__header">
        <h2 className="bonus__title">Tournament Bonus</h2>

        {locked ? (
          <div className="bonus__lock-badge" role="status" aria-label="Bonus picks are locked">
            <span className="bonus__lock-icon" aria-hidden="true">🔒</span>
            <span>Locked</span>
          </div>
        ) : bonus?.lock_at ? (
          <div className="bonus__countdown-wrap" aria-label={`Locks in ${countdown}`}>
            <span className="bonus__countdown-label">Locks in</span>
            <span className="bonus__countdown mono" aria-live="off">{countdown}</span>
            <span className="bonus__lock-date">
              ({formatLockIST(bonus.lock_at)} IST)
            </span>
          </div>
        ) : null}
      </div>

      {/* ── Mutation save error ──────────────────────────────────────────── */}
      {saveMutation.isError && (
        <p className="bonus__save-error" role="alert">
          {saveMutation.error instanceof Error &&
          saveMutation.error.message.includes("403")
            ? "Picks are now locked — no further changes allowed."
            : "Couldn’t save your pick — please try again."}
        </p>
      )}

      {/* ── Saving indicator ────────────────────────────────────────────── */}
      {saveMutation.isPending && (
        <p className="bonus__saving" aria-live="polite" role="status">
          Saving…
        </p>
      )}

      {/* ── Locked note ─────────────────────────────────────────────────── */}
      {locked && (
        <p className="bonus__locked-note" role="status">
          Picks are locked as of {bonus?.lock_at ? formatLockIST(bonus.lock_at) : ""} IST.
          Your selections are shown below.
        </p>
      )}

      {/* ── Teaching empty state (before any pick, not locked) ─────────── */}
      {!locked && !hasPicks && (
        <div className="bonus__empty">
          <span className="bonus__empty-icon" aria-hidden="true">🏆</span>
          <p className="bonus__empty-title">Make your tournament picks</p>
          <p className="bonus__empty-body">
            Select your predictions for all 7 awards below before the lock date.
            Earn up to 100 bonus points!
          </p>
        </div>
      )}

      {/* ── Category rows ───────────────────────────────────────────────── */}
      <ol className="bonus__list" aria-label="Bonus categories">
        {CATEGORIES.map((cat) => {
          const pick = pickMap.get(cat.key);
          const isDisabled = locked || saveMutation.isPending;

          return (
            <li key={cat.key} className="bonus-row">
              {/* Label + points */}
              <div className="bonus-row__label-wrap">
                <span className="bonus-row__label">{cat.label}</span>
                <span className="bonus-row__pts mono" aria-label={`${cat.points} points`}>
                  {cat.points} pts
                </span>
                {/* Earned points badge (after scoring) */}
                {pick?.points != null && (
                  <span
                    className={`bonus-row__earned mono${pick.points > 0 ? " bonus-row__earned--hit" : ""}`}
                    aria-label={`Earned ${pick.points} points`}
                  >
                    +{pick.points}
                  </span>
                )}
              </div>

              {/* Control: team select or player combobox */}
              <div className="bonus-row__ctrl">
                {cat.refType === "team" ? (
                  <select
                    className="bonus-row__select"
                    disabled={isDisabled}
                    aria-label={`Select team for ${cat.label}`}
                    value={pick?.ref_id ?? ""}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      if (v) handleTeamChange(cat.key, v);
                    }}
                  >
                    <option value="">Choose a team…</option>
                    {teams.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} ({t.code})
                      </option>
                    ))}
                  </select>
                ) : (
                  <PlayerCombobox
                    categoryKey={cat.key}
                    categoryLabel={cat.label}
                    disabled={isDisabled}
                    currentRefId={pick?.ref_id}
                    currentLabel={
                      // Use optimistic label briefly during mutation; then server label
                      optimisticLabels[cat.key] ?? pick?.label
                    }
                    onSelect={(id, label) => handlePlayerSelect(cat.key, id, label)}
                  />
                )}
              </div>
            </li>
          );
        })}
      </ol>

      {/* ── Max points note ──────────────────────────────────────────────── */}
      <p className="bonus__max-note">
        Max{" "}
        <span className="mono">
          {CATEGORIES.reduce((s, c) => s + c.points, 0)}
        </span>{" "}
        bonus points available.
      </p>
    </section>
  );
}
