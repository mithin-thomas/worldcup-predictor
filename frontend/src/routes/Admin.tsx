import { useState } from "react";
import { useMe } from "../lib/auth";
import { useTeams, type TeamOption } from "../lib/bonus";
import {
  useAdminMatches,
  useAdminUsers,
  useCreateMatch,
  useUpdateMatch,
  useDeleteMatch,
  useSetMatchResult,
  useSetUserRole,
  useSettings,
  useSaveSettings,
  useRecompute,
  type AdminMatch,
  type AdminUser,
  type AdminSettings,
  type RecomputeSummary,
} from "../lib/admin";

// ── IST helpers ───────────────────────────────────────────────────────────────

/** Format a UTC ISO string as "Sat, 14 Jun 2026 18:30 IST" */
function fmtKickoffIST(utc: string): string {
  return new Date(utc).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Format a UTC ISO string as a grouped date heading "Sun, 14 Jun 2026" */
function fmtDateIST(utc: string): string {
  return new Date(utc).toLocaleDateString("en-IN", {
    timeZone: "Asia/Kolkata",
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** Convert a local-IST datetime-local input value to UTC RFC3339. */
function istInputToUtcRfc3339(istValue: string): string {
  // Slice to YYYY-MM-DDTHH:mm to guard against browsers that include seconds
  const normalised = istValue.slice(0, 16);
  const dt = new Date(`${normalised}:00+05:30`);
  return dt.toISOString();
}

/** Convert a UTC ISO string to the datetime-local value in IST. */
function utcToIstInput(utc: string): string {
  const d = new Date(utc);
  // Shift to IST (+05:30)
  const ist = new Date(d.getTime() + 5.5 * 60 * 60 * 1000);
  return ist.toISOString().slice(0, 16);
}

/**
 * Convert an IST datetime-local value to RFC3339 with +05:30 offset.
 * The server accepts any valid RFC3339; using IST offset keeps bonus_lock_at
 * human-readable in the DB (as the spec examples show).
 */
function istInputToIstRfc3339(istValue: string): string {
  const normalised = istValue.slice(0, 16);
  return `${normalised}:00+05:30`;
}

/**
 * Convert an RFC3339 timestamp (any offset, including +05:30 or Z) to the
 * IST datetime-local input value.
 */
function rfc3339ToIstInput(rfc: string): string {
  const d = new Date(rfc);
  const ist = new Date(d.getTime() + 5.5 * 60 * 60 * 1000);
  return ist.toISOString().slice(0, 16);
}

// ── Confirm dialog ────────────────────────────────────────────────────────────

interface ConfirmDialogProps {
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

function ConfirmDialog({ message, confirmLabel = "Confirm", onConfirm, onCancel }: ConfirmDialogProps) {
  return (
    <div
      className="admin-dialog-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Confirm action"
      aria-describedby="confirm-dialog-msg"
      onKeyDown={(e) => { if (e.key === "Escape") onCancel(); }}
    >
      <div className="admin-dialog">
        <p id="confirm-dialog-msg" className="admin-dialog__msg">{message}</p>
        <div className="admin-dialog__actions">
          {/* autoFocus the Cancel button — safest default for a destructive confirm */}
          <button
            type="button"
            className="btn-ghost admin-dialog__cancel"
            onClick={onCancel}
            autoFocus
          >
            Cancel
          </button>
          <button
            type="button"
            className="admin-dialog__confirm"
            onClick={onConfirm}
            data-testid="confirm-dialog-confirm"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Match form (create/edit) ──────────────────────────────────────────────────

interface MatchFormProps {
  initial?: AdminMatch;
  teams: TeamOption[];
  onSubmit: (values: {
    home_team_id: number;
    away_team_id: number;
    kickoff_utc: string;
    stage: "group" | "knockout";
    round: string;
  }) => void;
  isPending: boolean;
  error: string | null;
  onCancel?: () => void;
  submitLabel?: string;
}

function MatchForm({
  initial,
  teams,
  onSubmit,
  isPending,
  error,
  onCancel,
  submitLabel = "Save",
}: MatchFormProps) {
  const [homeId, setHomeId] = useState<string>(initial?.home_team_id?.toString() ?? "");
  const [awayId, setAwayId] = useState<string>(initial?.away_team_id?.toString() ?? "");
  const [kickoff, setKickoff] = useState<string>(
    initial?.kickoff_utc ? utcToIstInput(initial.kickoff_utc) : "",
  );
  const [stage, setStage] = useState<"group" | "knockout">(initial?.stage ?? "group");
  const [round, setRound] = useState<string>(initial?.round ?? "");
  const [localErr, setLocalErr] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setLocalErr(null);
    const hid = parseInt(homeId, 10);
    const aid = parseInt(awayId, 10);
    if (!hid || !aid) { setLocalErr("Select both teams."); return; }
    if (hid === aid) { setLocalErr("Home and away teams must differ."); return; }
    if (!kickoff) { setLocalErr("Kickoff date/time is required."); return; }
    let utc: string;
    try {
      utc = istInputToUtcRfc3339(kickoff);
    } catch {
      setLocalErr("Invalid kickoff date/time.");
      return;
    }
    onSubmit({ home_team_id: hid, away_team_id: aid, kickoff_utc: utc, stage, round });
  };

  const displayError = localErr ?? error;

  return (
    <form className="admin-form" onSubmit={handleSubmit} noValidate>
      <div className="admin-form__row">
        <label className="admin-form__label" htmlFor="mf-home">Home team</label>
        <select
          id="mf-home"
          className="admin-form__select"
          value={homeId}
          onChange={(e) => setHomeId(e.target.value)}
          disabled={isPending}
          aria-label="Home team"
        >
          <option value="">Choose…</option>
          {teams.map((t) => (
            <option key={t.id} value={t.id}>{t.name} ({t.code})</option>
          ))}
        </select>
      </div>
      <div className="admin-form__row">
        <label className="admin-form__label" htmlFor="mf-away">Away team</label>
        <select
          id="mf-away"
          className="admin-form__select"
          value={awayId}
          onChange={(e) => setAwayId(e.target.value)}
          disabled={isPending}
          aria-label="Away team"
        >
          <option value="">Choose…</option>
          {teams.map((t) => (
            <option key={t.id} value={t.id}>{t.name} ({t.code})</option>
          ))}
        </select>
      </div>
      <div className="admin-form__row">
        <label className="admin-form__label" htmlFor="mf-kickoff">Kickoff (IST)</label>
        <input
          id="mf-kickoff"
          type="datetime-local"
          className="admin-form__input"
          value={kickoff}
          onChange={(e) => setKickoff(e.target.value)}
          disabled={isPending}
          aria-label="Kickoff time (IST)"
        />
      </div>
      <div className="admin-form__row">
        <label className="admin-form__label" htmlFor="mf-stage">Stage</label>
        <select
          id="mf-stage"
          className="admin-form__select"
          value={stage}
          onChange={(e) => setStage(e.target.value as "group" | "knockout")}
          disabled={isPending}
          aria-label="Stage"
        >
          <option value="group">Group</option>
          <option value="knockout">Knockout</option>
        </select>
      </div>
      <div className="admin-form__row">
        <label className="admin-form__label" htmlFor="mf-round">Round</label>
        <input
          id="mf-round"
          type="text"
          className="admin-form__input"
          value={round}
          onChange={(e) => setRound(e.target.value)}
          disabled={isPending}
          placeholder="e.g. Group A, Quarter-Final"
          aria-label="Round"
        />
      </div>

      {displayError && (
        <p className="admin-form__error" role="alert">{displayError}</p>
      )}

      <div className="admin-form__actions">
        {onCancel && (
          <button type="button" className="btn-ghost" onClick={onCancel} disabled={isPending}>
            Cancel
          </button>
        )}
        <button type="submit" className="btn-brand admin-form__submit" disabled={isPending}>
          {isPending ? "Saving…" : submitLabel}
        </button>
      </div>
    </form>
  );
}

// ── Result form ───────────────────────────────────────────────────────────────

interface ResultFormProps {
  match: AdminMatch;
  teams: TeamOption[];
  onSubmit: (values: {
    home_score: number;
    away_score: number;
    went_to_penalties: boolean;
    penalty_winner_team_id?: number | null;
  }) => void;
  isPending: boolean;
  error: string | null;
  onCancel: () => void;
}

function ResultForm({ match, teams, onSubmit, isPending, error, onCancel }: ResultFormProps) {
  const [homeScore, setHomeScore] = useState<string>(
    match.home_score != null ? String(match.home_score) : "",
  );
  const [awayScore, setAwayScore] = useState<string>(
    match.away_score != null ? String(match.away_score) : "",
  );
  const [penalties, setPenalties] = useState<boolean>(match.went_to_penalties);
  const [penWinner, setPenWinner] = useState<string>(
    match.penalty_winner_team_id?.toString() ?? "",
  );
  const [localErr, setLocalErr] = useState<string | null>(null);

  const isKnockout = match.stage === "knockout";

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setLocalErr(null);
    const hs = parseInt(homeScore, 10);
    const as_ = parseInt(awayScore, 10);
    if (isNaN(hs) || isNaN(as_)) { setLocalErr("Both scores are required."); return; }
    if (hs < 0 || as_ < 0) { setLocalErr("Scores must be non-negative."); return; }
    if (penalties && !isKnockout) { setLocalErr("Only knockout matches can go to penalties."); return; }
    if (penalties && !penWinner) { setLocalErr("Select the penalty shootout winner."); return; }
    onSubmit({
      home_score: hs,
      away_score: as_,
      went_to_penalties: penalties,
      penalty_winner_team_id: penalties ? parseInt(penWinner, 10) : null,
    });
  };

  const homeTeam = teams.find((t) => t.id === match.home_team_id);
  const awayTeam = teams.find((t) => t.id === match.away_team_id);
  const penaltyTeams = [homeTeam, awayTeam].filter(Boolean) as TeamOption[];

  const displayError = localErr ?? error;

  return (
    <form className="admin-form" onSubmit={handleSubmit} noValidate>
      <div className="admin-form__row admin-form__row--scores">
        <div className="admin-form__score-group">
          <label className="admin-form__label" htmlFor="rf-home">
            {match.home_team || match.home_code || "Home"}
          </label>
          <input
            id="rf-home"
            type="number"
            min="0"
            className="admin-form__input admin-form__input--score mono"
            value={homeScore}
            onChange={(e) => setHomeScore(e.target.value)}
            disabled={isPending}
            aria-label={`${match.home_team || "Home"} score`}
          />
        </div>
        <span className="admin-form__score-sep mono">–</span>
        <div className="admin-form__score-group">
          <label className="admin-form__label" htmlFor="rf-away">
            {match.away_team || match.away_code || "Away"}
          </label>
          <input
            id="rf-away"
            type="number"
            min="0"
            className="admin-form__input admin-form__input--score mono"
            value={awayScore}
            onChange={(e) => setAwayScore(e.target.value)}
            disabled={isPending}
            aria-label={`${match.away_team || "Away"} score`}
          />
        </div>
      </div>

      {isKnockout && (
        <div className="admin-form__row">
          {/* Wrapping label makes the entire row (≥44px) the click target */}
          <label className="admin-form__checkbox-row" htmlFor="rf-penalties">
            <input
              id="rf-penalties"
              type="checkbox"
              className="admin-form__checkbox"
              checked={penalties}
              onChange={(e) => {
                setPenalties(e.target.checked);
                if (!e.target.checked) setPenWinner("");
              }}
              disabled={isPending}
              aria-label="Match went to penalty shootout"
            />
            <span className="admin-form__checkbox-label">Went to penalties</span>
          </label>
        </div>
      )}

      {isKnockout && penalties && (
        <div className="admin-form__row" data-testid="penalty-winner-row">
          <label className="admin-form__label" htmlFor="rf-pen-winner">Penalty winner</label>
          <select
            id="rf-pen-winner"
            className="admin-form__select"
            value={penWinner}
            onChange={(e) => setPenWinner(e.target.value)}
            disabled={isPending}
            aria-label="Penalty shootout winner"
          >
            <option value="">Choose winner…</option>
            {penaltyTeams.map((t) => (
              <option key={t.id} value={t.id}>{t.name} ({t.code})</option>
            ))}
          </select>
        </div>
      )}

      {displayError && (
        <p className="admin-form__error" role="alert">{displayError}</p>
      )}

      <div className="admin-form__actions">
        <button type="button" className="btn-ghost" onClick={onCancel} disabled={isPending}>
          Cancel
        </button>
        <button type="submit" className="btn-brand admin-form__submit" disabled={isPending}>
          {isPending ? "Saving…" : "Set Result"}
        </button>
      </div>
    </form>
  );
}

// ── Matches section ───────────────────────────────────────────────────────────

function MatchesSection() {
  const { data: matches, isLoading, isError } = useAdminMatches();
  const { data: teams = [] } = useTeams();
  const createMatch = useCreateMatch();
  const updateMatch = useUpdateMatch();
  const deleteMatch = useDeleteMatch();
  const setResult = useSetMatchResult();

  const [showNewForm, setShowNewForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [resultId, setResultId] = useState<number | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);

  if (isLoading) {
    return (
      <div className="admin-skeleton" aria-busy="true" aria-label="Loading matches">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="admin-skeleton__row" aria-hidden="true">
            <div className="skeleton skeleton--text admin-skeleton__team" />
            <div className="skeleton skeleton--text admin-skeleton__meta" />
            <div className="skeleton skeleton--text admin-skeleton__actions" />
          </div>
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <p className="admin-alert" role="alert">
        Could not load matches. Please refresh and try again.
      </p>
    );
  }

  const list = matches ?? [];

  // Group by IST date
  const byDate = new Map<string, AdminMatch[]>();
  for (const m of list) {
    const dateKey = fmtDateIST(m.kickoff_utc);
    const group = byDate.get(dateKey) ?? [];
    group.push(m);
    byDate.set(dateKey, group);
  }

  const editingMatch = editingId != null ? list.find((m) => m.id === editingId) : undefined;
  const resultMatch = resultId != null ? list.find((m) => m.id === resultId) : undefined;
  const deleteMatch_ = deleteConfirmId != null ? list.find((m) => m.id === deleteConfirmId) : undefined;

  // Disable per-row action buttons while any match mutation is in-flight (prevent double-submit)
  const anyPending =
    createMatch.isPending ||
    updateMatch.isPending ||
    setResult.isPending ||
    deleteMatch.isPending;

  return (
    <div className="admin-matches">
      <div className="admin-section-header">
        <h2 className="admin-section-title">Matches</h2>
        <button
          type="button"
          className={showNewForm ? "btn-ghost" : "btn-brand"}
          onClick={() => {
            setShowNewForm((v) => !v);
            setEditingId(null);
            setResultId(null);
          }}
          aria-expanded={showNewForm}
        >
          {showNewForm ? "Cancel" : "+ New Match"}
        </button>
      </div>

      {showNewForm && (
        <div className="admin-panel">
          <h3 className="admin-panel__title">New Match</h3>
          <MatchForm
            teams={teams}
            onSubmit={(values) => {
              createMatch.mutate(values, {
                onSuccess: () => setShowNewForm(false),
              });
            }}
            isPending={createMatch.isPending}
            error={
              createMatch.isError
                ? (createMatch.error instanceof Error
                    ? createMatch.error.message
                    : "Failed to create match.")
                : null
            }
            onCancel={() => setShowNewForm(false)}
            submitLabel="Create Match"
          />
        </div>
      )}

      {editingMatch && (
        <div className="admin-panel">
          <h3 className="admin-panel__title">
            Edit Match: {editingMatch.home_team || editingMatch.home_code} vs {editingMatch.away_team || editingMatch.away_code}
          </h3>
          <MatchForm
            key={editingMatch.id}
            initial={editingMatch}
            teams={teams}
            onSubmit={(values) => {
              updateMatch.mutate({ id: editingMatch.id, ...values }, {
                onSuccess: () => setEditingId(null),
              });
            }}
            isPending={updateMatch.isPending}
            error={
              updateMatch.isError
                ? (updateMatch.error instanceof Error
                    ? updateMatch.error.message
                    : "Failed to update match.")
                : null
            }
            onCancel={() => setEditingId(null)}
            submitLabel="Save Changes"
          />
        </div>
      )}

      {resultMatch && (
        <div className="admin-panel">
          <h3 className="admin-panel__title">
            Set Result: {resultMatch.home_team || resultMatch.home_code} vs {resultMatch.away_team || resultMatch.away_code}
          </h3>
          <ResultForm
            key={resultMatch.id}
            match={resultMatch}
            teams={teams}
            onSubmit={(values) => {
              setResult.mutate({ id: resultMatch.id, ...values }, {
                onSuccess: () => setResultId(null),
              });
            }}
            isPending={setResult.isPending}
            error={
              setResult.isError
                ? (setResult.error instanceof Error
                    ? setResult.error.message
                    : "Failed to set result.")
                : null
            }
            onCancel={() => setResultId(null)}
          />
        </div>
      )}

      {list.length === 0 ? (
        <div className="admin-empty">
          <p className="admin-empty__title">No matches yet</p>
          <p className="admin-empty__body">
            Create a fixture using the button above. Team pickers load all registered teams.
          </p>
        </div>
      ) : (
        Array.from(byDate.entries()).map(([dateKey, dayMatches]) => (
          <div key={dateKey} className="admin-day">
            <h3 className="admin-day__header">{dateKey}</h3>
            <ul className="admin-match-list">
              {dayMatches.map((m) => (
                <li key={m.id} className="admin-match-item">
                  <div className="admin-match-item__teams">
                    <span className="admin-match-item__team">
                      <span className="admin-match-item__code mono">{m.home_code}</span>
                      <span className="admin-match-item__name">{m.home_team}</span>
                    </span>
                    <span className="admin-match-item__score mono" aria-label="Score">
                      {m.home_score != null && m.away_score != null
                        ? `${m.home_score} – ${m.away_score}`
                        : "vs"}
                    </span>
                    <span className="admin-match-item__team admin-match-item__team--away">
                      <span className="admin-match-item__name">{m.away_team}</span>
                      <span className="admin-match-item__code mono">{m.away_code}</span>
                    </span>
                  </div>

                  <div className="admin-match-item__meta">
                    <time className="admin-match-item__kickoff mono" dateTime={m.kickoff_utc}>
                      {fmtKickoffIST(m.kickoff_utc)} IST
                    </time>
                    <span className={`admin-match-item__status admin-match-item__status--${m.status}`}>
                      {m.status}
                    </span>
                    {m.manual_override && (
                      <span className="admin-match-item__override" title="Manually managed">
                        override
                      </span>
                    )}
                    {m.went_to_penalties && (
                      <span className="admin-match-item__pen">pen</span>
                    )}
                  </div>

                  <div className="admin-match-item__actions">
                    <button
                      type="button"
                      className="admin-action-btn"
                      aria-label={`Edit ${m.home_team} vs ${m.away_team}`}
                      disabled={anyPending}
                      onClick={() => {
                        setEditingId(editingId === m.id ? null : m.id);
                        setResultId(null);
                        setShowNewForm(false);
                      }}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="admin-action-btn"
                      aria-label={`Set result for ${m.home_team} vs ${m.away_team}`}
                      disabled={anyPending}
                      onClick={() => {
                        setResultId(resultId === m.id ? null : m.id);
                        setEditingId(null);
                        setShowNewForm(false);
                      }}
                    >
                      Result
                    </button>
                    <button
                      type="button"
                      className="admin-action-btn admin-action-btn--danger"
                      aria-label={`Delete ${m.home_team} vs ${m.away_team}`}
                      disabled={anyPending}
                      onClick={() => setDeleteConfirmId(m.id)}
                      data-testid={`delete-btn-${m.id}`}
                    >
                      Delete
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))
      )}

      {deleteMatch_ && (
        <ConfirmDialog
          message={`Delete "${deleteMatch_.home_team || deleteMatch_.home_code} vs ${deleteMatch_.away_team || deleteMatch_.away_code}"? This will also remove all predictions for this match.`}
          confirmLabel="Delete match"
          onConfirm={() => {
            const id = deleteMatch_.id;
            setDeleteConfirmId(null);
            deleteMatch.mutate(id);
          }}
          onCancel={() => setDeleteConfirmId(null)}
        />
      )}

      {deleteMatch.isError && (
        <p className="admin-alert" role="alert">
          {deleteMatch.error instanceof Error
            ? deleteMatch.error.message
            : "Failed to delete match."}
        </p>
      )}
    </div>
  );
}

// ── Users section ─────────────────────────────────────────────────────────────

function UsersSection() {
  const { data: me } = useMe();
  const { data: users, isLoading, isError } = useAdminUsers();
  const setRole = useSetUserRole();

  const [demoteConfirm, setDemoteConfirm] = useState<AdminUser | null>(null);

  if (isLoading) {
    return (
      <div className="admin-skeleton" aria-busy="true" aria-label="Loading users">
        {[1, 2, 3].map((i) => (
          <div key={i} className="admin-skeleton__row" aria-hidden="true">
            <div className="skeleton skeleton--text admin-skeleton__name" />
            <div className="skeleton skeleton--text admin-skeleton__badge" />
          </div>
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <p className="admin-alert" role="alert">
        Could not load users. Please refresh and try again.
      </p>
    );
  }

  const list = users ?? [];

  return (
    <div className="admin-users">
      <div className="admin-section-header">
        <h2 className="admin-section-title">Users</h2>
      </div>

      {setRole.isError && (
        <p className="admin-alert" role="alert">
          {setRole.error instanceof Error
            ? setRole.error.message
            : "Failed to update role."}
        </p>
      )}

      {list.length === 0 ? (
        <div className="admin-empty">
          <p className="admin-empty__title">No users yet</p>
          <p className="admin-empty__body">
            Users appear here after signing in with their SayOne Google account.
          </p>
        </div>
      ) : (
        <ul className="admin-user-list">
          {list.map((u) => {
            const isSelf = me?.id === u.id;
            const isAdmin = u.role === "admin";

            return (
              <li key={u.id} className="admin-user-item">
                <div className="admin-user-item__info">
                  <span className="admin-user-item__name">{u.name || u.email}</span>
                  <span className="admin-user-item__email muted">{u.email}</span>
                </div>
                <div className="admin-user-item__right">
                  <span
                    className={`admin-role-badge admin-role-badge--${u.role}`}
                    aria-label={`Role: ${u.role}`}
                  >
                    {u.role}
                  </span>
                  {!isSelf && (
                    <button
                      type="button"
                      className={`admin-role-btn${isAdmin ? " admin-role-btn--demote" : " admin-role-btn--promote"}`}
                      aria-label={isAdmin ? `Demote ${u.name || u.email} to user` : `Make ${u.name || u.email} an admin`}
                      disabled={setRole.isPending}
                      onClick={() => {
                        if (isAdmin) {
                          // demote requires confirm
                          setDemoteConfirm(u);
                        } else {
                          setRole.mutate({ id: u.id, role: "admin" });
                        }
                      }}
                    >
                      {isAdmin ? "Make user" : "Make admin"}
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {demoteConfirm && (
        <ConfirmDialog
          message={`Remove admin role from ${demoteConfirm.name || demoteConfirm.email}?`}
          confirmLabel="Demote to user"
          onConfirm={() => {
            const u = demoteConfirm;
            setDemoteConfirm(null);
            setRole.mutate({ id: u.id, role: "user" });
          }}
          onCancel={() => setDemoteConfirm(null)}
        />
      )}
    </div>
  );
}

// ── Settings section ──────────────────────────────────────────────────────────

function SettingsSection() {
  const { data: settings, isLoading, isError } = useSettings();
  const saveSettings = useSaveSettings();
  const recompute = useRecompute();

  // Local form state — prefilled from the query, editable by the user
  const [resultsCron, setResultsCron] = useState<string>("");
  const [weeklyCron, setWeeklyCron] = useState<string>("");
  // bonus_lock_at is stored as RFC3339; shown/edited in IST datetime-local
  const [bonusLockAt, setBonusLockAt] = useState<string>("");
  // Track whether we've initialised from the server response
  const [initialised, setInitialised] = useState(false);

  // Sync form state from server on first load
  if (settings && !initialised) {
    setResultsCron(settings.results_cron);
    setWeeklyCron(settings.weekly_cron);
    setBonusLockAt(rfc3339ToIstInput(settings.bonus_lock_at));
    setInitialised(true);
  }

  const [saveError, setSaveError] = useState<string | null>(null);
  const [recomputeResult, setRecomputeResult] = useState<RecomputeSummary | null>(null);
  const [showRecomputeConfirm, setShowRecomputeConfirm] = useState(false);

  // Reset recompute result when confirming dialog opens/closes
  const handleRecomputeClick = () => {
    setRecomputeResult(null);
    setShowRecomputeConfirm(true);
  };

  const handleRecomputeConfirm = () => {
    setShowRecomputeConfirm(false);
    recompute.mutate(undefined, {
      onSuccess: (data) => {
        setRecomputeResult(data);
      },
    });
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    setSaveError(null);
    setRecomputeResult(null);

    let bonusRfc3339: string;
    try {
      bonusRfc3339 = istInputToIstRfc3339(bonusLockAt);
      // Quick validity check
      if (isNaN(new Date(bonusRfc3339).getTime())) throw new Error("invalid");
    } catch {
      setSaveError("Invalid bonus lock date/time.");
      return;
    }

    const payload: Partial<AdminSettings> = {
      results_cron: resultsCron.trim(),
      weekly_cron: weeklyCron.trim(),
      bonus_lock_at: bonusRfc3339,
    };

    saveSettings.mutate(payload, {
      onSuccess: (updated) => {
        // Reconcile with the returned full set
        setResultsCron(updated.results_cron);
        setWeeklyCron(updated.weekly_cron);
        setBonusLockAt(rfc3339ToIstInput(updated.bonus_lock_at));
        setInitialised(true);
      },
      onError: (err) => {
        setSaveError(err instanceof Error ? err.message : "Failed to save settings.");
      },
    });
  };

  if (isLoading) {
    return (
      <div className="admin-settings__skeleton" aria-busy="true" aria-label="Loading settings">
        {[1, 2, 3].map((i) => (
          <div key={i} className="admin-settings__skeleton-field" aria-hidden="true">
            <div className="skeleton skeleton--text admin-settings__skeleton-label" />
            <div className="skeleton admin-settings__skeleton-input" />
          </div>
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <p className="admin-alert" role="alert">
        Could not load settings. Please refresh and try again.
      </p>
    );
  }

  return (
    <div className="admin-settings">
      {/* ── Settings form ── */}
      <div className="admin-panel">
        <h2 className="admin-section-title">Settings</h2>
        <form className="admin-form" onSubmit={handleSave} noValidate>
          <div className="admin-settings__fields">
            {/* results_cron */}
            <div className="admin-settings__field">
              <label className="admin-form__label" htmlFor="sf-results-cron">
                Results cron
              </label>
              <input
                id="sf-results-cron"
                type="text"
                className="admin-form__input mono"
                value={resultsCron}
                onChange={(e) => setResultsCron(e.target.value)}
                disabled={saveSettings.isPending}
                placeholder="e.g. 0 3,8,13 * * *"
                aria-label="Results cron expression"
                aria-describedby="sf-results-cron-note"
                spellCheck={false}
                autoComplete="off"
              />
              <p className="admin-settings__hint" id="sf-results-cron-note">
                e.g. <span className="mono">0 3,8,13 * * *</span> — standard 5-field cron (minute hour dom month dow)
              </p>
              <span className="admin-settings__restart-note" data-testid="results-cron-restart-note">
                Applies after restart
              </span>
            </div>

            {/* weekly_cron */}
            <div className="admin-settings__field">
              <label className="admin-form__label" htmlFor="sf-weekly-cron">
                Weekly cron
              </label>
              <input
                id="sf-weekly-cron"
                type="text"
                className="admin-form__input mono"
                value={weeklyCron}
                onChange={(e) => setWeeklyCron(e.target.value)}
                disabled={saveSettings.isPending}
                placeholder="e.g. 30 13 * * 1"
                aria-label="Weekly cron expression"
                aria-describedby="sf-weekly-cron-note"
                spellCheck={false}
                autoComplete="off"
              />
              <p className="admin-settings__hint" id="sf-weekly-cron-note">
                e.g. <span className="mono">30 13 * * 1</span> — runs every Monday at 13:30 IST
              </p>
              <span className="admin-settings__restart-note" data-testid="weekly-cron-restart-note">
                Applies after restart
              </span>
            </div>

            {/* bonus_lock_at */}
            <div className="admin-settings__field">
              <div className="admin-settings__label-row">
                <label className="admin-form__label" htmlFor="sf-bonus-lock-at">
                  Bonus lock at (IST)
                </label>
                <span className="admin-settings__live-badge" data-testid="bonus-lock-live-badge">
                  live
                </span>
              </div>
              <input
                id="sf-bonus-lock-at"
                type="datetime-local"
                className="admin-form__input"
                value={bonusLockAt}
                onChange={(e) => setBonusLockAt(e.target.value)}
                disabled={saveSettings.isPending}
                aria-label="Bonus lock date and time (IST)"
                aria-describedby="sf-bonus-lock-note"
              />
              <p className="admin-settings__hint" id="sf-bonus-lock-note">
                Date and time in IST — takes effect immediately after Save.
              </p>
            </div>
          </div>

          {saveError && (
            <p className="admin-settings__save-error" role="alert">
              {saveError}
            </p>
          )}

          {saveSettings.isError && !saveError && (
            <p className="admin-settings__save-error" role="alert">
              {saveSettings.error instanceof Error
                ? saveSettings.error.message
                : "Failed to save settings."}
            </p>
          )}

          <div className="admin-settings__actions">
            <button
              type="submit"
              className="btn-brand admin-form__submit"
              disabled={saveSettings.isPending}
            >
              {saveSettings.isPending ? "Saving…" : "Save settings"}
            </button>
          </div>
        </form>
      </div>

      {/* ── Recompute ── */}
      <div className="admin-panel admin-settings__recompute-panel">
        <div className="admin-settings__recompute">
          <h2 className="admin-settings__recompute-title">Recompute points</h2>
          <p className="admin-settings__recompute-desc">
            Re-derives all materialized points from stored match results and bonus outcomes —
            idempotent and safe to run any time. Won't change match results or past weekly winners.
          </p>

          <div className="admin-settings__recompute-row">
            <button
              type="button"
              className="btn-brand"
              onClick={handleRecomputeClick}
              disabled={recompute.isPending}
              aria-label="Recompute all points"
            >
              {recompute.isPending ? "Recomputing…" : "Recompute"}
            </button>

            {recompute.isError && (
              <p className="admin-settings__recompute-error" role="alert">
                {recompute.error instanceof Error
                  ? recompute.error.message
                  : "Recompute failed. Please try again."}
              </p>
            )}

            {recomputeResult && (
              <span
                className="admin-settings__recompute-summary"
                role="status"
                aria-live="polite"
                data-testid="recompute-summary"
              >
                <span>{recomputeResult.matches_rescored} matches rescored</span>
                <span aria-hidden="true">·</span>
                <span>{recomputeResult.predictions_updated} predictions</span>
                <span aria-hidden="true">·</span>
                <span>{recomputeResult.bonus_updated} bonus</span>
              </span>
            )}
          </div>
        </div>
      </div>

      {showRecomputeConfirm && (
        <ConfirmDialog
          message="Recompute all points from stored results? This won't change match results or past weekly winners."
          confirmLabel="Recompute"
          onConfirm={handleRecomputeConfirm}
          onCancel={() => setShowRecomputeConfirm(false)}
        />
      )}
    </div>
  );
}

// ── Admin screen (segmented control: Matches | Users | Settings) ──────────────

type AdminTab = "matches" | "users" | "settings";

export function Admin() {
  const { data: me } = useMe();
  const [tab, setTab] = useState<AdminTab>("matches");

  // Defense-in-depth: self-guard even though the nav already gates this route
  if (me !== undefined && me?.role !== "admin") {
    return (
      <section className="admin" aria-label="Admin">
        <p className="admin-alert" role="alert">
          This area is for administrators only.
        </p>
      </section>
    );
  }

  return (
    <section className="admin" aria-label="Admin">
      <div className="admin__tabs" role="tablist" aria-label="Admin sections">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "matches"}
          aria-controls="admin-panel-matches"
          id="admin-tab-matches"
          className={`admin__tab${tab === "matches" ? " is-active" : ""}`}
          onClick={() => setTab("matches")}
        >
          Matches
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "users"}
          aria-controls="admin-panel-users"
          id="admin-tab-users"
          className={`admin__tab${tab === "users" ? " is-active" : ""}`}
          onClick={() => setTab("users")}
        >
          Users
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "settings"}
          aria-controls="admin-panel-settings"
          id="admin-tab-settings"
          className={`admin__tab${tab === "settings" ? " is-active" : ""}`}
          onClick={() => setTab("settings")}
        >
          Settings
        </button>
      </div>

      <div
        id="admin-panel-matches"
        role="tabpanel"
        aria-labelledby="admin-tab-matches"
        hidden={tab !== "matches"}
        className="admin__panel"
      >
        <MatchesSection />
      </div>

      <div
        id="admin-panel-users"
        role="tabpanel"
        aria-labelledby="admin-tab-users"
        hidden={tab !== "users"}
        className="admin__panel"
      >
        <UsersSection />
      </div>

      <div
        id="admin-panel-settings"
        role="tabpanel"
        aria-labelledby="admin-tab-settings"
        hidden={tab !== "settings"}
        className="admin__panel"
      >
        <SettingsSection />
      </div>
    </section>
  );
}
