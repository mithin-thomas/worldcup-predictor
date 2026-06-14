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

import { useWinners, useMarkWinnerPaid } from "../lib/winners";
import { useMe } from "../lib/auth";

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient();
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const sample = {
  weeks: [
    {
      week_start: "2026-06-08",
      winners: [
        { user_id: 5, name: "Alice", avatar_url: "", points: 18, prize_paid: true },
        { user_id: 6, name: "Bob", avatar_url: "", points: 18, prize_paid: false },
      ],
    },
  ],
};

describe("HallOfFame", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset to default (non-pending, no error) state
    (useMarkWinnerPaid as ReturnType<typeof vi.fn>).mockReturnValue({
      mutate,
      isPending: false,
      isError: false,
      variables: undefined,
    });
  });

  it("renders champions with points", () => {
    (useWinners as ReturnType<typeof vi.fn>).mockReturnValue({ data: sample, isLoading: false, isError: false });
    (useMe as ReturnType<typeof vi.fn>).mockReturnValue({ data: { role: "user" } });
    wrap(<HallOfFame />);
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
    expect(screen.getByText(/Hall of Fame/i)).toBeInTheDocument();
  });

  it("shows mark-paid control for admins, read-only badge for users", () => {
    (useWinners as ReturnType<typeof vi.fn>).mockReturnValue({ data: sample, isLoading: false, isError: false });
    (useMe as ReturnType<typeof vi.fn>).mockReturnValue({ data: { role: "admin" } });
    const { rerender } = wrap(<HallOfFame />);
    // admin: toggle buttons present
    expect(screen.getAllByRole("button").length).toBeGreaterThan(0);

    (useMe as ReturnType<typeof vi.fn>).mockReturnValue({ data: { role: "user" } });
    const qc = new QueryClient();
    rerender(<QueryClientProvider client={qc}><HallOfFame /></QueryClientProvider>);
    // user: no toggle buttons at all (role/privacy contract)
    expect(screen.queryAllByRole("button")).toHaveLength(0);
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
    (useWinners as ReturnType<typeof vi.fn>).mockReturnValue({ data: sample, isLoading: false, isError: false });
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
    (useWinners as ReturnType<typeof vi.fn>).mockReturnValue({ data: sample, isLoading: false, isError: false });
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
});
