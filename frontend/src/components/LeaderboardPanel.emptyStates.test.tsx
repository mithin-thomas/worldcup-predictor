import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { LeaderboardPanel } from "./LeaderboardPanel";

vi.mock("../lib/leaderboard", () => ({ useLeaderboard: vi.fn() }));
import { useLeaderboard } from "../lib/leaderboard";

describe("LeaderboardPanel empty states", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows overall-specific empty copy on the Overall tab", () => {
    (useLeaderboard as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { rows: [], total: 0, page: 1, page_size: 20, period: "overall" },
      isLoading: false,
      isError: false,
    });
    render(<LeaderboardPanel />);
    expect(screen.getByText(/make your first prediction/i)).toBeInTheDocument();
  });

  it("shows weekly-specific empty copy on the Weekly tab", () => {
    (useLeaderboard as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { rows: [], total: 0, page: 1, page_size: 20, period: "week" },
      isLoading: false,
      isError: false,
    });
    render(<LeaderboardPanel />);
    fireEvent.click(screen.getByRole("radio", { name: /weekly/i }));
    expect(screen.getByText(/no scores this week yet/i)).toBeInTheDocument();
  });
});
