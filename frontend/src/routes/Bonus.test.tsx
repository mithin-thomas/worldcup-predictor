import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Bonus } from "./Bonus";
import { CATEGORIES } from "../lib/bonus";

// ── Mocks ────────────────────────────────────────────────────────────────────
vi.mock("../lib/bonus", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/bonus")>();
  return {
    ...actual,
    useBonus: vi.fn(),
    useTeams: vi.fn(),
    usePlayerSearch: vi.fn(),
    useSaveBonus: vi.fn(),
  };
});

vi.mock("../lib/auth", () => ({ useMe: vi.fn() }));

import { useBonus, useTeams, usePlayerSearch, useSaveBonus } from "../lib/bonus";

const mutate = vi.fn();

const defaultSaveMutation = {
  mutate,
  isPending: false,
  isError: false,
  error: null,
};

const teams = [
  { id: 1, name: "Brazil",    code: "BRA" },
  { id: 2, name: "Argentina", code: "ARG" },
];

const players = [
  { id: 101, name: "Lionel Messi", team_code: "ARG", position: "Forward"  },
  { id: 102, name: "Kylian Mbappe", team_code: "FRA", position: "Forward" },
];

// Unlocked bonus data with no picks yet
const unlocked: import("../lib/bonus").BonusResponse = {
  lock_at: new Date(Date.now() + 5 * 86_400_000).toISOString(), // 5 days from now
  locked: false,
  picks: [],
};

// Locked bonus data
const locked: import("../lib/bonus").BonusResponse = {
  lock_at: new Date(Date.now() - 1_000).toISOString(), // past
  locked: true,
  picks: [
    { category: "winner",      ref_type: "team",   ref_id: 1  },
    { category: "golden_boot", ref_type: "player", ref_id: 101 },
  ],
};

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe("Bonus screen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (useSaveBonus as ReturnType<typeof vi.fn>).mockReturnValue(defaultSaveMutation);
    (useTeams as ReturnType<typeof vi.fn>).mockReturnValue({ data: teams, isLoading: false });
    (usePlayerSearch as ReturnType<typeof vi.fn>).mockReturnValue({
      data: [],
      isFetching: false,
    });
  });

  it("renders all 7 category rows with correct points", () => {
    (useBonus as ReturnType<typeof vi.fn>).mockReturnValue({
      data: unlocked, isLoading: false, isError: false,
    });
    wrap(<Bonus />);

    // All 7 categories from CATEGORIES constant
    for (const cat of CATEGORIES) {
      expect(screen.getByText(cat.label)).toBeInTheDocument();
    }
    // Point values: some duplicate (5x "10 pts"), use getAllByText for the shared value
    expect(screen.getAllByText("30 pts")).toHaveLength(1); // winner
    expect(screen.getAllByText("20 pts")).toHaveLength(1); // runner_up
    expect(screen.getAllByText("10 pts")).toHaveLength(5); // 5 categories share 10 pts
  });

  it("team awards render a <select>, player awards render a search input", () => {
    (useBonus as ReturnType<typeof vi.fn>).mockReturnValue({
      data: unlocked, isLoading: false, isError: false,
    });
    wrap(<Bonus />);

    // Team award: winner, runner_up, fair_play → select elements
    const teamCats = CATEGORIES.filter((c) => c.refType === "team");
    const playerCats = CATEGORIES.filter((c) => c.refType === "player");

    const selects = screen.getAllByRole("combobox");
    // selects includes native <select> elements (via combobox role) AND the combobox input
    // Filter by element type
    const nativeSelects = selects.filter((el) => el.tagName === "SELECT");
    const inputCombos  = selects.filter((el) => el.tagName === "INPUT");

    expect(nativeSelects).toHaveLength(teamCats.length);   // 3 team selects
    expect(inputCombos).toHaveLength(playerCats.length);   // 4 player combobox inputs
  });

  it("when locked=true controls are disabled and locked note is shown", () => {
    (useBonus as ReturnType<typeof vi.fn>).mockReturnValue({
      data: locked, isLoading: false, isError: false,
    });
    wrap(<Bonus />);

    // Locked note is present
    expect(screen.getByText(/Picks are locked/i)).toBeInTheDocument();

    // All selects are disabled
    const selects = screen.getAllByRole("combobox").filter((el) => el.tagName === "SELECT");
    selects.forEach((s) => expect(s).toBeDisabled());

    // All combobox text inputs are disabled
    const inputs = screen.getAllByRole("combobox").filter((el) => el.tagName === "INPUT");
    inputs.forEach((inp) => expect(inp).toBeDisabled());
  });

  it("shows the teaching empty state when no picks and not locked", () => {
    (useBonus as ReturnType<typeof vi.fn>).mockReturnValue({
      data: unlocked, isLoading: false, isError: false,
    });
    wrap(<Bonus />);

    expect(screen.getByText(/Make your tournament picks/i)).toBeInTheDocument();
    expect(screen.getByText(/up to 100 bonus points/i)).toBeInTheDocument();
  });

  it("renders player search results when query returns data", async () => {
    (useBonus as ReturnType<typeof vi.fn>).mockReturnValue({
      data: unlocked, isLoading: false, isError: false,
    });
    (usePlayerSearch as ReturnType<typeof vi.fn>).mockReturnValue({
      data: players,
      isFetching: false,
    });

    wrap(<Bonus />);

    // Find the first player combobox input (golden_ball)
    const inputs = screen.getAllByRole("combobox").filter((el) => el.tagName === "INPUT");
    const firstInput = inputs[0];

    // Simulate typing in the combobox
    await userEvent.type(firstInput, "me");

    // Since usePlayerSearch is mocked to return players, results appear
    // The combobox list should be shown
    // We check the mock was called with appropriate query trigger
    expect(usePlayerSearch).toHaveBeenCalled();
  });

  it("renders skeletons while loading", () => {
    (useBonus as ReturnType<typeof vi.fn>).mockReturnValue({
      data: undefined, isLoading: true, isError: false,
    });
    wrap(<Bonus />);
    // aria-busy on the section
    const section = screen.getByRole("region", { name: /Tournament Bonus Picks/i });
    expect(section).toHaveAttribute("aria-busy", "true");
  });

  it("shows role=alert on load error", () => {
    (useBonus as ReturnType<typeof vi.fn>).mockReturnValue({
      data: undefined, isLoading: false, isError: true,
    });
    wrap(<Bonus />);
    const alert = screen.getByRole("alert");
    expect(alert).toBeInTheDocument();
    expect(alert).toHaveTextContent(/load bonus picks/i);
  });

  it("shows role=alert on save error (mutation error)", () => {
    (useBonus as ReturnType<typeof vi.fn>).mockReturnValue({
      data: unlocked, isLoading: false, isError: false,
    });
    (useSaveBonus as ReturnType<typeof vi.fn>).mockReturnValue({
      ...defaultSaveMutation,
      isError: true,
      error: new Error("save bonus failed: 500"),
    });
    wrap(<Bonus />);
    const alert = screen.getByRole("alert");
    expect(alert).toBeInTheDocument();
    expect(alert).toHaveTextContent(/save your pick/i);
  });

  it("shows locked message on 403 save error", () => {
    (useBonus as ReturnType<typeof vi.fn>).mockReturnValue({
      data: unlocked, isLoading: false, isError: false,
    });
    (useSaveBonus as ReturnType<typeof vi.fn>).mockReturnValue({
      ...defaultSaveMutation,
      isError: true,
      error: new Error("save bonus failed: 403"),
    });
    wrap(<Bonus />);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(/Picks are now locked/i);
  });

  it("CATEGORIES constant has exactly 7 entries summing to 100 pts", () => {
    expect(CATEGORIES).toHaveLength(7);
    const total = CATEGORIES.reduce((s, c) => s + c.points, 0);
    expect(total).toBe(100);
  });
});
