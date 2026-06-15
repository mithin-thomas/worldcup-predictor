import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BonusPanel } from "./BonusPanel";
import { CATEGORIES } from "../lib/bonus";

// Mock lib/bonus hooks
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

import { useBonus, useTeams, usePlayerSearch, useSaveBonus } from "../lib/bonus";

const mutate = vi.fn();
const defaultSave = { mutate, isPending: false, isError: false, error: null };

const teams = [
  { id: 1, name: "Brazil", code: "BRA" },
  { id: 2, name: "Argentina", code: "ARG" },
];

const unlocked: import("../lib/bonus").BonusResponse = {
  lock_at: new Date(Date.now() + 5 * 86_400_000).toISOString(),
  locked: false,
  picks: [],
};

const lockedBonus: import("../lib/bonus").BonusResponse = {
  lock_at: new Date(Date.now() - 1_000).toISOString(),
  locked: true,
  picks: [
    { category: "winner", ref_type: "team", ref_id: 1, label: "Brazil (BRA)" },
  ],
};

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe("BonusPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (useSaveBonus as ReturnType<typeof vi.fn>).mockReturnValue(defaultSave);
    (useTeams as ReturnType<typeof vi.fn>).mockReturnValue({ data: teams, isLoading: false });
    (usePlayerSearch as ReturnType<typeof vi.fn>).mockReturnValue({ data: [], isFetching: false });
  });

  // ── Collapsed state ───────────────────────────────────────────────────────
  it("renders collapsed by default with aria-expanded=false", () => {
    (useBonus as ReturnType<typeof vi.fn>).mockReturnValue({ data: unlocked, isLoading: false, isError: false });
    wrap(<BonusPanel />);
    const toggle = screen.getByRole("button", { name: /set tournament bonus picks/i });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  it("does not show category rows when collapsed", () => {
    (useBonus as ReturnType<typeof vi.fn>).mockReturnValue({ data: unlocked, isLoading: false, isError: false });
    wrap(<BonusPanel />);
    // Category labels should not be visible
    expect(screen.queryByText("World Cup Winner")).toBeNull();
  });

  // ── Expand / collapse ──────────────────────────────────────────────────────
  it("expands on click, showing all 7 category rows", async () => {
    (useBonus as ReturnType<typeof vi.fn>).mockReturnValue({ data: unlocked, isLoading: false, isError: false });
    const user = userEvent.setup();
    wrap(<BonusPanel />);

    await user.click(screen.getByRole("button", { name: /set tournament bonus picks/i }));

    // aria-expanded flips
    const toggle = screen.getByRole("button", { name: /hide tournament bonus picks/i });
    expect(toggle).toHaveAttribute("aria-expanded", "true");

    // All 7 categories visible
    for (const cat of CATEGORIES) {
      expect(screen.getByText(cat.label)).toBeInTheDocument();
    }
  });

  it("collapses when clicking again", async () => {
    (useBonus as ReturnType<typeof vi.fn>).mockReturnValue({ data: unlocked, isLoading: false, isError: false });
    const user = userEvent.setup();
    wrap(<BonusPanel />);

    await user.click(screen.getByRole("button", { name: /set tournament bonus picks/i }));
    expect(screen.getByText("World Cup Winner")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /hide tournament bonus picks/i }));
    expect(screen.queryByText("World Cup Winner")).toBeNull();
  });

  // ── Team search dropdown ──────────────────────────────────────────────────
  it("opens team dropdown and filters by search", async () => {
    (useBonus as ReturnType<typeof vi.fn>).mockReturnValue({ data: unlocked, isLoading: false, isError: false });
    const user = userEvent.setup();
    wrap(<BonusPanel />);

    await user.click(screen.getByRole("button", { name: /set tournament bonus picks/i }));

    // Click the Winner team select button
    const winnerSelect = screen.getByRole("button", { name: /Select team for World Cup Winner/i });
    await user.click(winnerSelect);

    // Search input appears
    const searchInput = screen.getByPlaceholderText(/Search teams/i);
    expect(searchInput).toBeInTheDocument();

    // Type "bra" → only Brazil visible
    await user.type(searchInput, "bra");
    expect(screen.getByText("Brazil")).toBeInTheDocument();
    expect(screen.queryByText("Argentina")).toBeNull();
  });

  it("shows 'No teams match' empty state in team dropdown", async () => {
    (useBonus as ReturnType<typeof vi.fn>).mockReturnValue({ data: unlocked, isLoading: false, isError: false });
    const user = userEvent.setup();
    wrap(<BonusPanel />);

    await user.click(screen.getByRole("button", { name: /set tournament bonus picks/i }));
    const winnerSelect = screen.getByRole("button", { name: /Select team for World Cup Winner/i });
    await user.click(winnerSelect);

    await user.type(screen.getByPlaceholderText(/Search teams/i), "zzz");
    expect(screen.getByText(/No teams match/i)).toBeInTheDocument();
  });

  it("calls saveMutation when a team is selected", async () => {
    (useBonus as ReturnType<typeof vi.fn>).mockReturnValue({ data: unlocked, isLoading: false, isError: false });
    const user = userEvent.setup();
    wrap(<BonusPanel />);

    await user.click(screen.getByRole("button", { name: /set tournament bonus picks/i }));
    const winnerSelect = screen.getByRole("button", { name: /Select team for World Cup Winner/i });
    await user.click(winnerSelect);
    await user.click(screen.getByRole("option", { name: /Brazil/i }));

    expect(mutate).toHaveBeenCalledWith([{ category: "winner", ref_id: 1 }]);
  });

  // ── Locked state ──────────────────────────────────────────────────────────
  it("shows 'Locked' in subtext when bonus is locked", () => {
    (useBonus as ReturnType<typeof vi.fn>).mockReturnValue({ data: lockedBonus, isLoading: false, isError: false });
    wrap(<BonusPanel />);
    expect(screen.getByText(/Locked/i)).toBeInTheDocument();
  });

  it("disables team select buttons when locked", async () => {
    (useBonus as ReturnType<typeof vi.fn>).mockReturnValue({ data: lockedBonus, isLoading: false, isError: false });
    const user = userEvent.setup();
    wrap(<BonusPanel />);

    // Expand
    await user.click(screen.getByRole("button", { name: /set tournament bonus picks/i }));

    // All team select buttons should be disabled
    const selects = screen.getAllByRole("button", { name: /Select team for/i });
    selects.forEach((btn) => expect(btn).toBeDisabled());
  });

  // ── Header stats ──────────────────────────────────────────────────────────
  it("shows correct pts tag (0/100 when no picks)", () => {
    (useBonus as ReturnType<typeof vi.fn>).mockReturnValue({ data: unlocked, isLoading: false, isError: false });
    wrap(<BonusPanel />);
    expect(screen.getByText("/100 pts")).toBeInTheDocument();
  });

  it("shows 'N/7 picks set' count", () => {
    (useBonus as ReturnType<typeof vi.fn>).mockReturnValue({ data: unlocked, isLoading: false, isError: false });
    wrap(<BonusPanel />);
    expect(screen.getByText(/0\/7 picks set/i)).toBeInTheDocument();
  });

  // ── Loading / error ───────────────────────────────────────────────────────
  it("renders skeleton when loading", () => {
    (useBonus as ReturnType<typeof vi.fn>).mockReturnValue({ data: undefined, isLoading: true, isError: false });
    wrap(<BonusPanel />);
    const container = screen.getByLabelText(/Loading Tournament Bonus/i);
    expect(container).toHaveAttribute("aria-busy", "true");
  });

  it("shows error alert on load failure", () => {
    (useBonus as ReturnType<typeof vi.fn>).mockReturnValue({ data: undefined, isLoading: false, isError: true });
    wrap(<BonusPanel />);
    expect(screen.getByRole("alert")).toHaveTextContent(/load bonus picks/i);
  });

  it("shows save error alert on mutation failure", async () => {
    (useBonus as ReturnType<typeof vi.fn>).mockReturnValue({ data: unlocked, isLoading: false, isError: false });
    (useSaveBonus as ReturnType<typeof vi.fn>).mockReturnValue({
      ...defaultSave,
      isError: true,
      error: new Error("save bonus failed: 500"),
    });
    wrap(<BonusPanel />);
    expect(screen.getByRole("alert")).toHaveTextContent(/save your pick/i);
  });

  it("shows locked message for 403 save error", () => {
    (useBonus as ReturnType<typeof vi.fn>).mockReturnValue({ data: unlocked, isLoading: false, isError: false });
    (useSaveBonus as ReturnType<typeof vi.fn>).mockReturnValue({
      ...defaultSave,
      isError: true,
      error: new Error("save bonus failed: 403"),
    });
    wrap(<BonusPanel />);
    expect(screen.getByRole("alert")).toHaveTextContent(/Picks are now locked/i);
  });
});
