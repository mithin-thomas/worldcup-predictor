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
  type AdminMatch,
  type AdminUser,
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
  // istValue looks like "2026-06-20T18:30" — treat as IST (+05:30)
  const dt = new Date(`${istValue}:00+05:30`);
  return dt.toISOString();
}

/** Convert a UTC ISO string to the datetime-local value in IST. */
function utcToIstInput(utc: string): string {
  const d = new Date(utc);
  // Shift to IST (+05:30)
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
    <div className="admin-dialog-overlay" role="dialog" aria-modal="true" aria-label="Confirm action">
      <div className="admin-dialog">
        <p className="admin-dialog__msg">{message}</p>
        <div className="admin-dialog__actions">
          <button type="button" className="btn-ghost admin-dialog__cancel" onClick={onCancel}>
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
        <div className="admin-form__row admin-form__row--inline">
          <label className="admin-form__label" htmlFor="rf-penalties">Went to penalties</label>
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

  return (
    <div className="admin-matches">
      <div className="admin-section-header">
        <h2 className="admin-section-title">Matches</h2>
        <button
          type="button"
          className="btn-brand"
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

// ── Admin screen (segmented control: Matches | Users) ─────────────────────────

type AdminTab = "matches" | "users";

export function Admin() {
  const [tab, setTab] = useState<AdminTab>("matches");

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
    </section>
  );
}
