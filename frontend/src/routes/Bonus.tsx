import { useEffect, useState } from "react";
import {
  CATEGORIES,
  useBonus,
  useTeams,
  useSaveBonus,
  type BonusPick,
  type PlayerOption,
} from "../lib/bonus";
import { PlayerCombobox } from "../components/PlayerCombobox";

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
                    comboboxKey={cat.key}
                    ariaLabel={`Search players for ${cat.label}`}
                    disabled={isDisabled}
                    currentRefId={pick?.ref_id}
                    currentLabel={
                      // Use optimistic label briefly during mutation; then server label
                      optimisticLabels[cat.key] ?? pick?.label
                    }
                    onSelect={(opt: PlayerOption) =>
                      handlePlayerSelect(cat.key, opt.id, `${opt.name} · ${opt.team_code}`)
                    }
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
