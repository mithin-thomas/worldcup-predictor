import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { HallOfFame } from "./HallOfFame";

// Hoisted shared mutate spy so tests can assert on it
const mutate = vi.fn();

vi.mock("../lib/winners", () => ({
  useWinners: vi.fn(),
  useMarkWinnerPaid: vi.fn(() => ({
    mutate,
    isPending: false,
    isError: false,
    variables: undefined,
  })),
}));
vi.mock("../lib/auth", () => ({ useMe: vi.fn() }));
// currentISTMonday is hard to freeze; we just let it return the real value.
// Tests that need specific week-vs-current behaviour use a week far in the past.

import { useWinners, useMarkWinnerPaid } from "../lib/winners";
import { useMe } from "../lib/auth";

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient();
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

// Sample data: one week (2026-06-08) with two winners
const sampleSingle = {
  weeks: [
    {
      week_start: "2026-06-08",
      winners: [
        { user_id: 5, name: "Alice", avatar_url: "", points: 18, prize_paid: true },
        { user_id: 6, name: "Bob",   avatar_url: "", points: 18, prize_paid: false },
      ],
    },
  ],
};

// Two weeks: newest = "2026-06-15", oldest = "2026-06-08"
const sampleTwo = {
  weeks: [
    {
      week_start: "2026-06-08",
      winners: [{ user_id: 5, name: "Alice", avatar_url: "", points: 18, prize_paid: true }],
    },
    {
      week_start: "2026-06-15",
      winners: [{ user_id: 7, name: "Carol", avatar_url: "", points: 22, prize_paid: false }],
    },
  ],
};

// Three weeks for pagination tests
const sampleThree = {
  weeks: [
    { week_start: "2026-06-01", winners: [{ user_id: 1, name: "Dave",  avatar_url: "", points: 10, prize_paid: false }] },
    { week_start: "2026-06-08", winners: [{ user_id: 2, name: "Eve",   avatar_url: "", points: 14, prize_paid: false }] },
    { week_start: "2026-06-15", winners: [{ user_id: 3, name: "Frank", avatar_url: "", points: 20, prize_paid: false }] },
  ],
};

describe("HallOfFame", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (useMarkWinnerPaid as ReturnType<typeof vi.fn>).mockReturnValue({
      mutate,
      isPending: false,
      isError: false,
      variables: undefined,
    });
  });

  it("renders champions with points and week label", () => {
    (useWinners as ReturnType<typeof vi.fn>).mockReturnValue({ data: sampleSingle, isLoading: false, isError: false });
    (useMe as ReturnType<typeof vi.fn>).mockReturnValue({ data: { role: "user" } });
    wrap(<HallOfFame />);
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
    expect(screen.getByText(/Hall of Fame/i)).toBeInTheDocument();
    // week range for 2026-06-08 → "8–14 Jun 2026"
    expect(screen.getByText("8–14 Jun 2026")).toBeInTheDocument();
  });

  it("shows mark-paid control for admins, read-only badge for non-admins", () => {
    (useWinners as ReturnType<typeof vi.fn>).mockReturnValue({ data: sampleSingle, isLoading: false, isError: false });
    (useMe as ReturnType<typeof vi.fn>).mockReturnValue({ data: { role: "admin" } });
    const { rerender } = wrap(<HallOfFame />);
    // admin: toggle buttons (mark-paid + nav arrows) present
    expect(screen.getAllByRole("button").length).toBeGreaterThan(0);
    // specifically the mark-paid button for Bob exists
    expect(screen.getByRole("button", { name: /Mark Bob's prize paid/i })).toBeInTheDocument();

    (useMe as ReturnType<typeof vi.fn>).mockReturnValue({ data: { role: "user" } });
    const qc = new QueryClient();
    rerender(<QueryClientProvider client={qc}><HallOfFame /></QueryClientProvider>);
    // user: no mark-paid buttons — only nav arrows remain (and they don't match "mark" pattern)
    expect(screen.queryByRole("button", { name: /mark/i })).toBeNull();
    // paid badges still render
    expect(screen.getAllByText(/paid/i).length).toBeGreaterThan(0);
  });

  it("renders a teaching empty state", () => {
    (useWinners as ReturnType<typeof vi.fn>).mockReturnValue({ data: { weeks: [] }, isLoading: false, isError: false });
    (useMe as ReturnType<typeof vi.fn>).mockReturnValue({ data: { role: "user" } });
    wrap(<HallOfFame />);
    expect(screen.getByText(/no champions yet/i)).toBeInTheDocument();
  });

  it("calls mutate with correct payload when admin clicks Mark paid for Bob (unpaid winner)", async () => {
    (useWinners as ReturnType<typeof vi.fn>).mockReturnValue({ data: sampleSingle, isLoading: false, isError: false });
    (useMe as ReturnType<typeof vi.fn>).mockReturnValue({ data: { role: "admin" } });
    wrap(<HallOfFame />);

    const markPaidBtn = screen.getByRole("button", { name: /Mark Bob's prize paid/i });
    await userEvent.click(markPaidBtn);

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate).toHaveBeenCalledWith({
      week_start: "2026-06-08",
      user_id: 6,
      paid: true,
    });
  });

  it("renders role=alert error message when mutation is in error state", () => {
    (useWinners as ReturnType<typeof vi.fn>).mockReturnValue({ data: sampleSingle, isLoading: false, isError: false });
    (useMe as ReturnType<typeof vi.fn>).mockReturnValue({ data: { role: "admin" } });
    (useMarkWinnerPaid as ReturnType<typeof vi.fn>).mockReturnValue({
      mutate,
      isPending: false,
      isError: true,
      variables: undefined,
    });
    wrap(<HallOfFame />);

    const alert = screen.getByRole("alert");
    expect(alert).toBeInTheDocument();
    expect(alert).toHaveTextContent(/couldn't update payout/i);
  });

  // ─── NEW TESTS: single-week PREV/NEXT paging (newest-first) ─────────────────

  it("starts on the newest week (index 0 after sort)", () => {
    (useWinners as ReturnType<typeof vi.fn>).mockReturnValue({ data: sampleTwo, isLoading: false, isError: false });
    (useMe as ReturnType<typeof vi.fn>).mockReturnValue({ data: { role: "user" } });
    wrap(<HallOfFame />);
    // Newest week = 2026-06-15 → "15–21 Jun 2026"
    expect(screen.getByText("15–21 Jun 2026")).toBeInTheDocument();
    // Carol (in the newest week) should be visible
    expect(screen.getByText("Carol")).toBeInTheDocument();
    // Alice (in older week) should NOT be visible
    expect(screen.queryByText("Alice")).toBeNull();
  });

  it("prev arrow is disabled on the newest week (can't go more recent)", () => {
    (useWinners as ReturnType<typeof vi.fn>).mockReturnValue({ data: sampleTwo, isLoading: false, isError: false });
    (useMe as ReturnType<typeof vi.fn>).mockReturnValue({ data: { role: "user" } });
    wrap(<HallOfFame />);
    const prevBtn = screen.getByRole("button", { name: /More recent week/i });
    expect(prevBtn).toBeDisabled();
  });

  it("next arrow navigates to an earlier week", async () => {
    (useWinners as ReturnType<typeof vi.fn>).mockReturnValue({ data: sampleTwo, isLoading: false, isError: false });
    (useMe as ReturnType<typeof vi.fn>).mockReturnValue({ data: { role: "user" } });
    wrap(<HallOfFame />);
    const nextBtn = screen.getByRole("button", { name: /Earlier week/i });
    await userEvent.click(nextBtn);
    // Now showing older week = 2026-06-08 → "8–14 Jun 2026"
    expect(screen.getByText("8–14 Jun 2026")).toBeInTheDocument();
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.queryByText("Carol")).toBeNull();
  });

  it("next arrow is disabled at the oldest week", async () => {
    (useWinners as ReturnType<typeof vi.fn>).mockReturnValue({ data: sampleTwo, isLoading: false, isError: false });
    (useMe as ReturnType<typeof vi.fn>).mockReturnValue({ data: { role: "user" } });
    wrap(<HallOfFame />);
    const nextBtn = screen.getByRole("button", { name: /Earlier week/i });
    await userEvent.click(nextBtn); // now at oldest
    expect(nextBtn).toBeDisabled();
  });

  it("prev arrow re-enables and navigates back to newer week", async () => {
    (useWinners as ReturnType<typeof vi.fn>).mockReturnValue({ data: sampleTwo, isLoading: false, isError: false });
    (useMe as ReturnType<typeof vi.fn>).mockReturnValue({ data: { role: "user" } });
    wrap(<HallOfFame />);
    const nextBtn = screen.getByRole("button", { name: /Earlier week/i });
    const prevBtn = screen.getByRole("button", { name: /More recent week/i });
    await userEvent.click(nextBtn); // go to older week
    expect(prevBtn).not.toBeDisabled();
    await userEvent.click(prevBtn); // back to newest
    expect(screen.getByText("15–21 Jun 2026")).toBeInTheDocument();
  });

  it("pager count shows correct fraction", async () => {
    (useWinners as ReturnType<typeof vi.fn>).mockReturnValue({ data: sampleThree, isLoading: false, isError: false });
    (useMe as ReturnType<typeof vi.fn>).mockReturnValue({ data: { role: "user" } });
    wrap(<HallOfFame />);
    // Starts at newest week index 0 → pager should show "1 / 3 weeks"
    expect(screen.getByText(/1 \/ 3 weeks/i)).toBeInTheDocument();

    const nextBtn = screen.getByRole("button", { name: /Earlier week/i });
    await userEvent.click(nextBtn);
    expect(screen.getByText(/2 \/ 3 weeks/i)).toBeInTheDocument();

    await userEvent.click(nextBtn);
    expect(screen.getByText(/3 \/ 3 weeks/i)).toBeInTheDocument();
  });

  it("shows 'Pending' badge for non-admin when prize not paid", () => {
    (useWinners as ReturnType<typeof vi.fn>).mockReturnValue({ data: sampleSingle, isLoading: false, isError: false });
    (useMe as ReturnType<typeof vi.fn>).mockReturnValue({ data: { role: "user" } });
    wrap(<HallOfFame />);
    // Bob has prize_paid: false → should show "Pending" for non-admin
    expect(screen.getByText("Pending")).toBeInTheDocument();
  });

  it("shows only the current week's winners (not previous weeks)", async () => {
    (useWinners as ReturnType<typeof vi.fn>).mockReturnValue({ data: sampleThree, isLoading: false, isError: false });
    (useMe as ReturnType<typeof vi.fn>).mockReturnValue({ data: { role: "user" } });
    wrap(<HallOfFame />);
    // Newest = 2026-06-15 → Frank visible; Dave/Eve not visible
    expect(screen.getByText("Frank")).toBeInTheDocument();
    expect(screen.queryByText("Dave")).toBeNull();
    expect(screen.queryByText("Eve")).toBeNull();
  });
});
