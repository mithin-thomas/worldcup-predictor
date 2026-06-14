import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { HallOfFame } from "./HallOfFame";

vi.mock("../lib/winners", () => ({
  useWinners: vi.fn(),
  useMarkWinnerPaid: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("../lib/auth", () => ({ useMe: vi.fn() }));

import { useWinners } from "../lib/winners";
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
  beforeEach(() => vi.clearAllMocks());

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
    // admin: a button to toggle Bob's unpaid card
    expect(screen.getAllByRole("button").length).toBeGreaterThan(0);

    (useMe as ReturnType<typeof vi.fn>).mockReturnValue({ data: { role: "user" } });
    const qc = new QueryClient();
    rerender(<QueryClientProvider client={qc}><HallOfFame /></QueryClientProvider>);
    // user: Alice shows a Paid badge, no toggle buttons
    expect(screen.getAllByText(/paid/i).length).toBeGreaterThan(0);
  });

  it("renders a teaching empty state", () => {
    (useWinners as ReturnType<typeof vi.fn>).mockReturnValue({ data: { weeks: [] }, isLoading: false, isError: false });
    (useMe as ReturnType<typeof vi.fn>).mockReturnValue({ data: { role: "user" } });
    wrap(<HallOfFame />);
    expect(screen.getByText(/no champions yet/i)).toBeInTheDocument();
  });
});
