import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Admin } from "./Admin";

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("../lib/admin", () => ({
  useAdminMatches: vi.fn(),
  useAdminUsers: vi.fn(),
  useCreateMatch: vi.fn(),
  useUpdateMatch: vi.fn(),
  useDeleteMatch: vi.fn(),
  useSetMatchResult: vi.fn(),
  useSetUserRole: vi.fn(),
  useSettings: vi.fn(),
  useSaveSettings: vi.fn(),
  useRecompute: vi.fn(),
  useBonusResults: vi.fn(),
  useSaveBonusResults: vi.fn(),
}));

vi.mock("../lib/auth", () => ({
  useMe: vi.fn(),
}));

vi.mock("../lib/bonus", () => ({
  useTeams: vi.fn(),
  usePlayerSearch: vi.fn(),
}));

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
  useBonusResults,
  useSaveBonusResults,
} from "../lib/admin";
import { useMe } from "../lib/auth";
import { useTeams, usePlayerSearch } from "../lib/bonus";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const teams = [
  { id: 1, name: "Brazil", code: "BRA" },
  { id: 2, name: "Argentina", code: "ARG" },
];

const groupMatch: import("../lib/admin").AdminMatch = {
  id: 10,
  match_number: 1,
  stage: "group",
  round: "Group A",
  home_team_id: 1,
  home_team: "Brazil",
  home_code: "BRA",
  away_team_id: 2,
  away_team: "Argentina",
  away_code: "ARG",
  kickoff_utc: "2026-06-20T13:00:00Z",
  status: "scheduled",
  home_score: null,
  away_score: null,
  went_to_penalties: false,
  penalty_winner_team_id: null,
  manual_override: false,
};

const knockoutMatch: import("../lib/admin").AdminMatch = {
  id: 20,
  match_number: 50,
  stage: "knockout",
  round: "Quarter-Final",
  home_team_id: 1,
  home_team: "Brazil",
  home_code: "BRA",
  away_team_id: 2,
  away_team: "Argentina",
  away_code: "ARG",
  kickoff_utc: "2026-07-05T13:00:00Z",
  status: "final",
  home_score: 1,
  away_score: 1,
  went_to_penalties: false,
  penalty_winner_team_id: null,
  manual_override: true,
};

const groupMatch2: import("../lib/admin").AdminMatch = {
  id: 11,
  match_number: 2,
  stage: "group",
  round: "Group B",
  home_team_id: 3,
  home_team: "France",
  home_code: "FRA",
  away_team_id: 4,
  away_team: "Germany",
  away_code: "GER",
  kickoff_utc: "2026-06-21T13:00:00Z",
  status: "scheduled",
  home_score: null,
  away_score: null,
  went_to_penalties: false,
  penalty_winner_team_id: null,
  manual_override: false,
};

const adminUser: import("../lib/admin").AdminUser = {
  id: 1,
  email: "admin@sayonetech.com",
  name: "Admin User",
  avatar_url: "",
  role: "admin",
};

const regularUser: import("../lib/admin").AdminUser = {
  id: 2,
  email: "user@sayonetech.com",
  name: "Regular User",
  avatar_url: "",
  role: "user",
};

const noopMutation = {
  mutate: vi.fn(),
  isPending: false,
  isError: false,
  error: null,
};

// ── Bonus results fixture (canonical order: winner, runner_up, golden_ball,
//    golden_boot, golden_glove, young_player, fair_play)
const defaultBonusResults: import("../lib/admin").BonusResultRow[] = [
  { category: "winner",       points: 30, ref_type: "team",   ref_id: 1, label: "Brazil",      set: true  },
  { category: "runner_up",    points: 20, ref_type: "team",   ref_id: 0, label: "",             set: false },
  { category: "golden_ball",  points: 10, ref_type: "player", ref_id: 0, label: "",             set: false },
  { category: "golden_boot",  points: 10, ref_type: "player", ref_id: 0, label: "",             set: false },
  { category: "golden_glove", points: 10, ref_type: "player", ref_id: 0, label: "",             set: false },
  { category: "young_player", points: 10, ref_type: "player", ref_id: 0, label: "",             set: false },
  { category: "fair_play",    points: 10, ref_type: "team",   ref_id: 2, label: "Argentina",    set: true  },
];

const defaultSettings: import("../lib/admin").AdminSettings = {
  results_cron: "0 3,8,13 * * *",
  weekly_cron: "30 13 * * 1",
  bonus_lock_at: "2026-06-28T23:59:00+05:30",
};

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

function setupDefaultMocks() {
  vi.mocked(useAdminMatches).mockReturnValue({
    data: [groupMatch],
    isLoading: false,
    isError: false,
  } as unknown as ReturnType<typeof useAdminMatches>);

  vi.mocked(useAdminUsers).mockReturnValue({
    data: [adminUser, regularUser],
    isLoading: false,
    isError: false,
  } as unknown as ReturnType<typeof useAdminUsers>);

  vi.mocked(useTeams).mockReturnValue({
    data: teams,
    isLoading: false,
    isError: false,
  } as unknown as ReturnType<typeof useTeams>);

  vi.mocked(useMe).mockReturnValue({
    data: { id: 99, email: "other@sayonetech.com", name: "Other Admin", role: "admin" as const },
    isLoading: false,
  } as unknown as ReturnType<typeof useMe>);

  vi.mocked(useCreateMatch).mockReturnValue(noopMutation as unknown as ReturnType<typeof useCreateMatch>);
  vi.mocked(useUpdateMatch).mockReturnValue(noopMutation as unknown as ReturnType<typeof useUpdateMatch>);
  vi.mocked(useDeleteMatch).mockReturnValue(noopMutation as unknown as ReturnType<typeof useDeleteMatch>);
  vi.mocked(useSetMatchResult).mockReturnValue(noopMutation as unknown as ReturnType<typeof useSetMatchResult>);
  vi.mocked(useSetUserRole).mockReturnValue(noopMutation as unknown as ReturnType<typeof useSetUserRole>);

  vi.mocked(useSettings).mockReturnValue({
    data: defaultSettings,
    isLoading: false,
    isError: false,
  } as unknown as ReturnType<typeof useSettings>);

  vi.mocked(useSaveSettings).mockReturnValue(noopMutation as unknown as ReturnType<typeof useSaveSettings>);
  vi.mocked(useRecompute).mockReturnValue(noopMutation as unknown as ReturnType<typeof useRecompute>);

  vi.mocked(useBonusResults).mockReturnValue({
    data: { results: defaultBonusResults },
    isLoading: false,
    isError: false,
  } as unknown as ReturnType<typeof useBonusResults>);

  vi.mocked(useSaveBonusResults).mockReturnValue(
    noopMutation as unknown as ReturnType<typeof useSaveBonusResults>
  );

  vi.mocked(usePlayerSearch).mockReturnValue({
    data: [],
    isFetching: false,
  } as unknown as ReturnType<typeof usePlayerSearch>);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Admin screen — matches tab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultMocks();
  });

  it("renders the match list with team names and actions", () => {
    wrap(<Admin />);

    // Default tab is Matches
    expect(screen.getByRole("tab", { name: "Matches" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Users" })).toBeInTheDocument();

    // Match entry
    expect(screen.getByText("Brazil")).toBeInTheDocument();
    expect(screen.getByText("Argentina")).toBeInTheDocument();

    // Action buttons
    expect(
      screen.getByRole("button", { name: /Edit Brazil vs Argentina/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Set result for Brazil vs Argentina/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Delete Brazil vs Argentina/i }),
    ).toBeInTheDocument();
  });

  it("shows a confirm dialog before calling deleteMatch.mutate", async () => {
    const deleteM = vi.fn();
    vi.mocked(useDeleteMatch).mockReturnValue({
      ...noopMutation,
      mutate: deleteM,
    } as unknown as ReturnType<typeof useDeleteMatch>);

    wrap(<Admin />);

    const deleteBtn = screen.getByTestId("delete-btn-10");
    fireEvent.click(deleteBtn);

    // Confirm dialog should appear
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText(/Delete "Brazil vs Argentina"/i)).toBeInTheDocument();

    // Mutation not yet called
    expect(deleteM).not.toHaveBeenCalled();

    // Click cancel — dialog dismisses, mutation still not called
    const cancelBtn = screen.getByRole("button", { name: "Cancel" });
    fireEvent.click(cancelBtn);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(deleteM).not.toHaveBeenCalled();
  });

  it("calls deleteMatch.mutate after confirming", async () => {
    const deleteM = vi.fn();
    vi.mocked(useDeleteMatch).mockReturnValue({
      ...noopMutation,
      mutate: deleteM,
    } as unknown as ReturnType<typeof useDeleteMatch>);

    wrap(<Admin />);

    fireEvent.click(screen.getByTestId("delete-btn-10"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("confirm-dialog-confirm"));
    expect(deleteM).toHaveBeenCalledWith(10);
  });

  it("hides penalty-winner picker for a group match (not knockout)", async () => {
    // Open result form for the group match
    wrap(<Admin />);

    const resultBtn = screen.getByRole("button", {
      name: /Set result for Brazil vs Argentina/i,
    });
    fireEvent.click(resultBtn);

    // The "went to penalties" checkbox should NOT appear for group stage
    expect(screen.queryByLabelText(/penalty shootout/i)).not.toBeInTheDocument();
    // No penalty-winner row
    expect(screen.queryByTestId("penalty-winner-row")).not.toBeInTheDocument();
  });

  it("reveals penalty-winner picker only when stage=knockout AND went_to_penalties is checked", async () => {
    vi.mocked(useAdminMatches).mockReturnValue({
      data: [knockoutMatch],
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useAdminMatches>);

    wrap(<Admin />);

    // Open result form for the knockout match
    const resultBtn = screen.getByRole("button", {
      name: /Set result for Brazil vs Argentina/i,
    });
    fireEvent.click(resultBtn);

    // Checkbox visible but not yet checked → no penalty winner picker
    const penCheckbox = screen.getByLabelText(/penalty shootout/i);
    expect(penCheckbox).toBeInTheDocument();
    // knockoutMatch.went_to_penalties is false initially — picker hidden
    expect(screen.queryByTestId("penalty-winner-row")).not.toBeInTheDocument();

    // Check the box → picker appears
    fireEvent.click(penCheckbox);
    expect(screen.getByTestId("penalty-winner-row")).toBeInTheDocument();
    expect(screen.getByLabelText(/Penalty shootout winner/i)).toBeInTheDocument();

    // Uncheck → picker disappears
    fireEvent.click(penCheckbox);
    expect(screen.queryByTestId("penalty-winner-row")).not.toBeInTheDocument();
  });

  it("shows an empty state when there are no matches", () => {
    vi.mocked(useAdminMatches).mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useAdminMatches>);

    wrap(<Admin />);
    expect(screen.getByText("No matches yet")).toBeInTheDocument();
  });

  it("shows skeleton while loading", () => {
    vi.mocked(useAdminMatches).mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
    } as unknown as ReturnType<typeof useAdminMatches>);

    wrap(<Admin />);
    expect(screen.getByLabelText("Loading matches")).toBeInTheDocument();
  });

  it("shows role=alert error when matches fail to load", () => {
    vi.mocked(useAdminMatches).mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
    } as unknown as ReturnType<typeof useAdminMatches>);

    wrap(<Admin />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("FIX 1: switching Edit from match A to match B remounts with B's values", () => {
    // Two matches: groupMatch (id=10, Brazil vs Argentina) and groupMatch2 (id=11, France vs Germany)
    vi.mocked(useAdminMatches).mockReturnValue({
      data: [groupMatch, groupMatch2],
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useAdminMatches>);

    // Provide all 4 teams so the select can reflect the correct value
    vi.mocked(useTeams).mockReturnValue({
      data: [
        { id: 1, name: "Brazil", code: "BRA" },
        { id: 2, name: "Argentina", code: "ARG" },
        { id: 3, name: "France", code: "FRA" },
        { id: 4, name: "Germany", code: "GER" },
      ],
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useTeams>);

    wrap(<Admin />);

    // Open Edit on match A (Brazil vs Argentina, id=10)
    fireEvent.click(screen.getByRole("button", { name: /Edit Brazil vs Argentina/i }));
    // The edit panel heading should reference A
    expect(screen.getByText(/Edit Match: Brazil vs Argentina/i)).toBeInTheDocument();

    // Now open Edit on match B (France vs Germany, id=11) — should replace A's form
    fireEvent.click(screen.getByRole("button", { name: /Edit France vs Germany/i }));
    // Panel heading should switch to B
    expect(screen.getByText(/Edit Match: France vs Germany/i)).toBeInTheDocument();
    // A's panel heading should no longer be visible
    expect(screen.queryByText(/Edit Match: Brazil vs Argentina/i)).not.toBeInTheDocument();

    // The home-team select should now show France (id=3), not Brazil (id=1)
    const homeSelect = screen.getByLabelText("Home team") as HTMLSelectElement;
    expect(homeSelect.value).toBe("3");
  });

  it("FIX 7: createMatch mutation error renders role=alert", () => {
    vi.mocked(useCreateMatch).mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
      isError: true,
      error: new Error("Kickoff must be in the future"),
    } as unknown as ReturnType<typeof useCreateMatch>);

    wrap(<Admin />);

    // Open the new-match form
    fireEvent.click(screen.getByRole("button", { name: /New Match/i }));

    // The error alert (role="alert") from the form should be present
    const alerts = screen.getAllByRole("alert");
    expect(alerts.length).toBeGreaterThan(0);
    expect(alerts.some((el) => el.textContent?.includes("Kickoff must be in the future"))).toBe(true);
  });
});

describe("Admin screen — users tab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultMocks();
  });

  it("renders user list with role badges", async () => {
    wrap(<Admin />);

    // Switch to users tab
    fireEvent.click(screen.getByRole("tab", { name: "Users" }));

    expect(screen.getByText("Admin User")).toBeInTheDocument();
    expect(screen.getByText("Regular User")).toBeInTheDocument();

    // Role badges
    const badges = screen.getAllByLabelText(/Role:/i);
    expect(badges.length).toBeGreaterThan(0);
  });

  it("shows no role-toggle for the current user's own row", async () => {
    // Set me.id = adminUser.id (id=1)
    vi.mocked(useMe).mockReturnValue({
      data: { id: 1, email: "admin@sayonetech.com", name: "Admin User", role: "admin" as const },
      isLoading: false,
    } as unknown as ReturnType<typeof useMe>);

    wrap(<Admin />);
    fireEvent.click(screen.getByRole("tab", { name: "Users" }));

    // The current user (Admin User, id=1) should NOT have a Make user / Make admin button
    // Regular User (id=2) SHOULD have a Make admin button
    expect(
      screen.queryByRole("button", { name: /Demote Admin User/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Make Admin User/i }),
    ).not.toBeInTheDocument();

    // Regular User's button should exist
    expect(
      screen.getByRole("button", { name: /Make Regular User an admin/i }),
    ).toBeInTheDocument();
  });

  it("shows confirm dialog before demoting an admin", async () => {
    const setRoleM = vi.fn();
    vi.mocked(useSetUserRole).mockReturnValue({
      ...noopMutation,
      mutate: setRoleM,
    } as unknown as ReturnType<typeof useSetUserRole>);

    // Both users, me is someone else (id=99)
    vi.mocked(useMe).mockReturnValue({
      data: { id: 99, email: "other@sayonetech.com", name: "Other", role: "admin" as const },
      isLoading: false,
    } as unknown as ReturnType<typeof useMe>);

    wrap(<Admin />);
    fireEvent.click(screen.getByRole("tab", { name: "Users" }));

    // Demote the admin user
    const demoteBtn = screen.getByRole("button", { name: /Demote Admin User to user/i });
    fireEvent.click(demoteBtn);

    // Dialog should appear
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText(/Remove admin role from Admin User/i)).toBeInTheDocument();

    // setRole not called yet
    expect(setRoleM).not.toHaveBeenCalled();

    // Confirm
    fireEvent.click(screen.getByTestId("confirm-dialog-confirm"));
    expect(setRoleM).toHaveBeenCalledWith({ id: 1, role: "user" });
  });

  it("promotes a user to admin without confirmation", async () => {
    const setRoleM = vi.fn();
    vi.mocked(useSetUserRole).mockReturnValue({
      ...noopMutation,
      mutate: setRoleM,
    } as unknown as ReturnType<typeof useSetUserRole>);

    vi.mocked(useMe).mockReturnValue({
      data: { id: 99, email: "other@sayonetech.com", name: "Other", role: "admin" as const },
      isLoading: false,
    } as unknown as ReturnType<typeof useMe>);

    wrap(<Admin />);
    fireEvent.click(screen.getByRole("tab", { name: "Users" }));

    const promoteBtn = screen.getByRole("button", { name: /Make Regular User an admin/i });
    fireEvent.click(promoteBtn);

    // Promotion: no confirm dialog, mutation called immediately
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(setRoleM).toHaveBeenCalledWith({ id: 2, role: "admin" });
  });

  it("shows empty state when user list is empty", () => {
    vi.mocked(useAdminUsers).mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useAdminUsers>);

    wrap(<Admin />);
    fireEvent.click(screen.getByRole("tab", { name: "Users" }));

    expect(screen.getByText("No users yet")).toBeInTheDocument();
  });
});

describe("Admin screen — settings tab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultMocks();
  });

  it("renders the Settings tab in the segmented control", () => {
    wrap(<Admin />);
    expect(screen.getByRole("tab", { name: "Settings" })).toBeInTheDocument();
  });

  it("renders all three setting values when the tab is selected", () => {
    wrap(<Admin />);
    fireEvent.click(screen.getByRole("tab", { name: "Settings" }));

    const resultsCronInput = screen.getByLabelText("Results cron expression") as HTMLInputElement;
    const weeklyCronInput = screen.getByLabelText("Weekly cron expression") as HTMLInputElement;

    expect(resultsCronInput.value).toBe("0 3,8,13 * * *");
    expect(weeklyCronInput.value).toBe("30 13 * * 1");
    // bonus_lock_at is shown as a datetime-local in IST — just check it's populated
    const bonusInput = screen.getByLabelText("Bonus lock date and time (IST)") as HTMLInputElement;
    expect(bonusInput.value).not.toBe("");
  });

  it("shows the 'Applies after restart' note on cron fields", () => {
    wrap(<Admin />);
    fireEvent.click(screen.getByRole("tab", { name: "Settings" }));

    const notes = screen.getAllByTestId(/.*restart-note/);
    expect(notes.length).toBeGreaterThanOrEqual(2);
    notes.forEach((n) => expect(n.textContent).toMatch(/applies after restart/i));
  });

  it("shows 'live' badge on the bonus_lock_at field", () => {
    wrap(<Admin />);
    fireEvent.click(screen.getByRole("tab", { name: "Settings" }));

    expect(screen.getByTestId("bonus-lock-live-badge")).toBeInTheDocument();
    expect(screen.getByTestId("bonus-lock-live-badge").textContent?.toLowerCase()).toContain("live");
  });

  it("shows a role=alert when useSaveSettings returns an error", () => {
    vi.mocked(useSaveSettings).mockReturnValue({
      mutate: vi.fn((_vars, opts) => {
        opts?.onError?.(new Error("invalid cron expression"), undefined, undefined);
      }),
      isPending: false,
      isError: false,
      error: null,
    } as unknown as ReturnType<typeof useSaveSettings>);

    wrap(<Admin />);
    fireEvent.click(screen.getByRole("tab", { name: "Settings" }));

    // Submit the form
    fireEvent.click(screen.getByRole("button", { name: /save settings/i }));

    const alert = screen.getByRole("alert");
    expect(alert).toBeInTheDocument();
    expect(alert.textContent).toMatch(/invalid cron expression/i);
  });

  it("shows skeleton while settings are loading", () => {
    vi.mocked(useSettings).mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
    } as unknown as ReturnType<typeof useSettings>);

    wrap(<Admin />);
    fireEvent.click(screen.getByRole("tab", { name: "Settings" }));

    expect(screen.getByLabelText("Loading settings")).toBeInTheDocument();
  });

  it("shows a role=alert error when settings fail to load", () => {
    vi.mocked(useSettings).mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
    } as unknown as ReturnType<typeof useSettings>);

    wrap(<Admin />);
    fireEvent.click(screen.getByRole("tab", { name: "Settings" }));

    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("requires confirm before calling recompute.mutate", () => {
    const recomputeMutate = vi.fn();
    vi.mocked(useRecompute).mockReturnValue({
      mutate: recomputeMutate,
      isPending: false,
      isError: false,
      error: null,
    } as unknown as ReturnType<typeof useRecompute>);

    wrap(<Admin />);
    fireEvent.click(screen.getByRole("tab", { name: "Settings" }));

    // Click Recompute button — should show confirm dialog first
    fireEvent.click(screen.getByRole("button", { name: /recompute all points/i }));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText(/recompute all points from stored results/i)).toBeInTheDocument();

    // Mutation not yet called
    expect(recomputeMutate).not.toHaveBeenCalled();

    // Cancel — dialog gone, mutation still not called
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(recomputeMutate).not.toHaveBeenCalled();
  });

  it("FIX 7: bonus_lock_at input is pre-filled with IST rendering of server value", () => {
    // Server sends "2026-06-28T23:59:00+05:30"; datetime-local value should be "2026-06-28T23:59"
    wrap(<Admin />);
    fireEvent.click(screen.getByRole("tab", { name: "Settings" }));

    const bonusInput = screen.getByLabelText("Bonus lock date and time (IST)") as HTMLInputElement;
    expect(bonusInput.value).toBe("2026-06-28T23:59");
  });

  it("FIX 7: submitting Settings form calls save mutation with IST RFC3339 bonus_lock_at and trimmed crons", () => {
    const mutateSpy = vi.fn();
    vi.mocked(useSaveSettings).mockReturnValue({
      mutate: mutateSpy,
      isPending: false,
      isError: false,
      error: null,
    } as unknown as ReturnType<typeof useSaveSettings>);

    wrap(<Admin />);
    fireEvent.click(screen.getByRole("tab", { name: "Settings" }));

    fireEvent.click(screen.getByRole("button", { name: /save settings/i }));

    expect(mutateSpy).toHaveBeenCalledTimes(1);
    const payload = mutateSpy.mock.calls[0][0] as Record<string, string>;
    expect(payload.results_cron).toBe("0 3,8,13 * * *");
    expect(payload.weekly_cron).toBe("30 13 * * 1");
    // IST RFC3339: "2026-06-28T23:59:00+05:30"
    expect(payload.bonus_lock_at).toBe("2026-06-28T23:59:00+05:30");
  });

  it("calls recompute.mutate after confirming and shows the returned summary", () => {
    const summary: import("../lib/admin").RecomputeSummary = {
      matches_rescored: 12,
      predictions_updated: 48,
      bonus_updated: 30,
    };

    const recomputeMutate = vi.fn((_vars, opts) => {
      opts?.onSuccess?.(summary, undefined, undefined);
    });
    vi.mocked(useRecompute).mockReturnValue({
      mutate: recomputeMutate,
      isPending: false,
      isError: false,
      error: null,
    } as unknown as ReturnType<typeof useRecompute>);

    wrap(<Admin />);
    fireEvent.click(screen.getByRole("tab", { name: "Settings" }));

    fireEvent.click(screen.getByRole("button", { name: /recompute all points/i }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    // Confirm
    fireEvent.click(screen.getByTestId("confirm-dialog-confirm"));

    // Dialog gone, mutate called
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(recomputeMutate).toHaveBeenCalledTimes(1);

    // Summary shown
    const summaryEl = screen.getByTestId("recompute-summary");
    expect(summaryEl).toBeInTheDocument();
    expect(summaryEl.textContent).toMatch(/12 matches rescored/);
    expect(summaryEl.textContent).toMatch(/48 predictions/);
    expect(summaryEl.textContent).toMatch(/30 bonus/);
  });
});

describe("Admin screen — bonus tab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultMocks();
  });

  it("renders the Bonus tab in the segmented control", () => {
    wrap(<Admin />);
    expect(screen.getByRole("tab", { name: "Bonus" })).toBeInTheDocument();
  });

  it("renders all 7 category rows in canonical order when Bonus tab is selected", () => {
    wrap(<Admin />);
    fireEvent.click(screen.getByRole("tab", { name: "Bonus" }));

    // All 7 categories present
    expect(screen.getByTestId("bonus-row-winner")).toBeInTheDocument();
    expect(screen.getByTestId("bonus-row-runner_up")).toBeInTheDocument();
    expect(screen.getByTestId("bonus-row-golden_ball")).toBeInTheDocument();
    expect(screen.getByTestId("bonus-row-golden_boot")).toBeInTheDocument();
    expect(screen.getByTestId("bonus-row-golden_glove")).toBeInTheDocument();
    expect(screen.getByTestId("bonus-row-young_player")).toBeInTheDocument();
    expect(screen.getByTestId("bonus-row-fair_play")).toBeInTheDocument();
  });

  it("team-award rows render a <select> element", () => {
    wrap(<Admin />);
    fireEvent.click(screen.getByRole("tab", { name: "Bonus" }));

    // winner, runner_up, fair_play are team awards
    expect(screen.getByTestId("team-select-winner")).toBeInTheDocument();
    expect(screen.getByTestId("team-select-runner_up")).toBeInTheDocument();
    expect(screen.getByTestId("team-select-fair_play")).toBeInTheDocument();
  });

  it("player-award rows render the player search combobox input", () => {
    wrap(<Admin />);
    fireEvent.click(screen.getByRole("tab", { name: "Bonus" }));

    // golden_ball, golden_boot, golden_glove, young_player are player awards
    expect(screen.getByTestId("player-combobox-admin-bonus-golden_ball")).toBeInTheDocument();
    expect(screen.getByTestId("player-combobox-admin-bonus-golden_boot")).toBeInTheDocument();
    expect(screen.getByTestId("player-combobox-admin-bonus-golden_glove")).toBeInTheDocument();
    expect(screen.getByTestId("player-combobox-admin-bonus-young_player")).toBeInTheDocument();
  });

  it("a set category shows its label; an unset category shows 'Not set'", () => {
    wrap(<Admin />);
    fireEvent.click(screen.getByRole("tab", { name: "Bonus" }));

    // winner is set → shows "Brazil"
    expect(screen.getByTestId("outcome-label-winner")).toBeInTheDocument();
    expect(screen.getByTestId("outcome-label-winner").textContent).toContain("Brazil");

    // runner_up is not set → shows "Not set"
    expect(screen.getByTestId("outcome-unset-runner_up")).toBeInTheDocument();
    expect(screen.getByTestId("outcome-unset-runner_up").textContent).toContain("Not set");

    // fair_play is set → shows "Argentina"
    expect(screen.getByTestId("outcome-label-fair_play")).toBeInTheDocument();
    expect(screen.getByTestId("outcome-label-fair_play").textContent).toContain("Argentina");
  });

  it("Save outcomes button calls the mutation with the selected entries", () => {
    const mutateSpy = vi.fn();
    vi.mocked(useSaveBonusResults).mockReturnValue({
      ...noopMutation,
      mutate: mutateSpy,
    } as unknown as ReturnType<typeof useSaveBonusResults>);

    wrap(<Admin />);
    fireEvent.click(screen.getByRole("tab", { name: "Bonus" }));

    // Click Save outcomes — should call mutate with the currently seeded picks
    // (winner → ref_id:1, fair_play → ref_id:2 — both set in defaultBonusResults)
    fireEvent.click(screen.getByRole("button", { name: /save bonus outcomes/i }));

    expect(mutateSpy).toHaveBeenCalledTimes(1);
    const [entries] = mutateSpy.mock.calls[0] as [{ category: string; ref_id: number }[], unknown];
    // Must include winner (ref_id:1) and fair_play (ref_id:2)
    expect(entries.some((e) => e.category === "winner" && e.ref_id === 1)).toBe(true);
    expect(entries.some((e) => e.category === "fair_play" && e.ref_id === 2)).toBe(true);
    // Must not include unset entries (ref_id:0)
    expect(entries.every((e) => e.ref_id > 0)).toBe(true);
  });

  it("shows 'Saved — standings updated' on success", () => {
    const mutateSpy = vi.fn((_entries, opts) => {
      opts?.onSuccess?.({ saved: 2 }, undefined, undefined);
    });
    vi.mocked(useSaveBonusResults).mockReturnValue({
      ...noopMutation,
      mutate: mutateSpy,
    } as unknown as ReturnType<typeof useSaveBonusResults>);

    wrap(<Admin />);
    fireEvent.click(screen.getByRole("tab", { name: "Bonus" }));
    fireEvent.click(screen.getByRole("button", { name: /save bonus outcomes/i }));

    const statusEl = screen.getByRole("status");
    expect(statusEl.textContent).toContain("Saved — standings updated");
  });

  it("shows role=alert when save fails", () => {
    const mutateSpy = vi.fn((_entries, opts) => {
      opts?.onError?.(new Error("server error"), undefined, undefined);
    });
    vi.mocked(useSaveBonusResults).mockReturnValue({
      ...noopMutation,
      mutate: mutateSpy,
    } as unknown as ReturnType<typeof useSaveBonusResults>);

    wrap(<Admin />);
    fireEvent.click(screen.getByRole("tab", { name: "Bonus" }));
    fireEvent.click(screen.getByRole("button", { name: /save bonus outcomes/i }));

    const alertEl = screen.getByRole("alert");
    expect(alertEl.textContent).toMatch(/server error/i);
  });

  it("shows skeleton while bonus results are loading", () => {
    vi.mocked(useBonusResults).mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
    } as unknown as ReturnType<typeof useBonusResults>);

    wrap(<Admin />);
    fireEvent.click(screen.getByRole("tab", { name: "Bonus" }));

    expect(screen.getByLabelText("Loading bonus outcomes")).toBeInTheDocument();
  });

  it("shows role=alert error when bonus results fail to load", () => {
    vi.mocked(useBonusResults).mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
    } as unknown as ReturnType<typeof useBonusResults>);

    wrap(<Admin />);
    fireEvent.click(screen.getByRole("tab", { name: "Bonus" }));

    expect(screen.getByRole("alert")).toBeInTheDocument();
  });
});
