import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StandingCard } from "./StandingCard";
import type { LeaderboardResponse } from "../lib/leaderboard";

// Mock hooks
vi.mock("../lib/auth", () => ({ useMe: vi.fn() }));
vi.mock("../lib/leaderboard", () => ({ useLeaderboard: vi.fn() }));

import { useMe } from "../lib/auth";
import { useLeaderboard } from "../lib/leaderboard";

const mockUseMe = useMe as ReturnType<typeof vi.fn>;
const mockUseLeaderboard = useLeaderboard as ReturnType<typeof vi.fn>;

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient();
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

// Helper to make a minimal overall response
function makeOverall(opts: {
  myRank?: number;
  myPoints?: number;
  leaderPoints?: number;
  meNull?: boolean;
}): Partial<LeaderboardResponse> {
  const { myRank = 2, myPoints = 12, leaderPoints = 18, meNull = false } = opts;
  return {
    period: "overall",
    page: 1,
    page_size: 20,
    total: 2,
    rows: [
      { rank: 1, user_id: 5, name: "Leader", avatar_url: "", points: leaderPoints, exact: 3, correct: 1, is_winner: false, is_me: false },
      { rank: 2, user_id: 1, name: "Me", avatar_url: "", points: myPoints, exact: 1, correct: 3, is_winner: false, is_me: true },
    ],
    me: meNull ? null : { rank: myRank, points: myPoints },
  };
}

function makeWeekly(weeklyRank: number | null): Partial<LeaderboardResponse> {
  return {
    period: "week",
    page: 1,
    page_size: 20,
    total: 1,
    rows: weeklyRank != null ? [
      { rank: weeklyRank, user_id: 1, name: "Me", avatar_url: "", points: 5, exact: 1, correct: 0, is_winner: false, is_me: true },
    ] : [],
    me: weeklyRank != null ? { rank: weeklyRank, points: 5 } : null,
  };
}

const loaded = { isLoading: false, isError: false };

beforeEach(() => {
  vi.clearAllMocks();
  mockUseMe.mockReturnValue({ data: { name: "Me" }, isLoading: false });
});

describe("StandingCard", () => {
  it("renders rank, name, points, and weekly rank", () => {
    mockUseLeaderboard.mockImplementation((period: string) => ({
      ...loaded,
      data: period === "overall" ? makeOverall({ myRank: 2, myPoints: 12, leaderPoints: 18 }) : makeWeekly(3),
    }) as unknown as ReturnType<typeof useLeaderboard>);

    wrap(<StandingCard />);

    expect(screen.getByText("Me")).toBeInTheDocument();
    // rank #2
    expect(screen.getByLabelText("Rank 2")).toBeInTheDocument();
    // points
    expect(screen.getByText("12")).toBeInTheDocument();
    // weekly rank
    expect(screen.getByText("#3")).toBeInTheDocument();
  });

  it("shows gap behind leader when not rank 1", () => {
    mockUseLeaderboard.mockImplementation((period: string) => ({
      ...loaded,
      data: period === "overall" ? makeOverall({ myRank: 2, myPoints: 12, leaderPoints: 18 }) : makeWeekly(null),
    }) as unknown as ReturnType<typeof useLeaderboard>);

    wrap(<StandingCard />);

    // gap = 18 - 12 = 6
    expect(screen.getByText("6 pts behind #1")).toBeInTheDocument();
  });

  it("shows 'Leading' when user is rank 1", () => {
    // Override me to rank 1 in both rows and me field
    const overallRank1: Partial<LeaderboardResponse> = {
      period: "overall",
      page: 1,
      page_size: 20,
      total: 1,
      rows: [
        { rank: 1, user_id: 1, name: "Me", avatar_url: "", points: 20, exact: 4, correct: 0, is_winner: false, is_me: true },
      ],
      me: { rank: 1, points: 20 },
    };
    mockUseLeaderboard.mockImplementation((period: string) => ({
      ...loaded,
      data: period === "overall" ? overallRank1 : makeWeekly(1),
    }) as unknown as ReturnType<typeof useLeaderboard>);

    wrap(<StandingCard />);

    expect(screen.getByText("Leading")).toBeInTheDocument();
  });

  it("shows teaching empty state when user has no rank yet", () => {
    mockUseLeaderboard.mockImplementation((period: string) => ({
      ...loaded,
      data: period === "overall"
        ? { period: "overall", page: 1, page_size: 20, total: 0, rows: [], me: null }
        : { period: "week", page: 1, page_size: 20, total: 0, rows: [], me: null },
    }) as unknown as ReturnType<typeof useLeaderboard>);

    wrap(<StandingCard />);

    expect(screen.getByText(/make your first prediction/i)).toBeInTheDocument();
  });

  it("leaderPoints === 0: no NaN bar width, renders 'Leading'", () => {
    // When there's only one player (the user) and leader has 0 pts,
    // the bar should not produce NaN or crash. barPct clamps to 100 (isLeading case).
    const overallZeroPts: Partial<LeaderboardResponse> = {
      period: "overall",
      page: 1,
      page_size: 20,
      total: 1,
      rows: [
        { rank: 1, user_id: 1, name: "Me", avatar_url: "", points: 0, exact: 0, correct: 0, is_winner: false, is_me: true },
      ],
      me: { rank: 1, points: 0 },
    };
    mockUseLeaderboard.mockImplementation((period: string) => ({
      ...loaded,
      data: period === "overall" ? overallZeroPts : makeWeekly(null),
    }) as unknown as ReturnType<typeof useLeaderboard>);

    wrap(<StandingCard />);

    // "Leading" should render (rank 1 path) without NaN
    expect(screen.getByText("Leading")).toBeInTheDocument();
    // The bar-fill width should be a valid CSS value (100%)
    const fill = document.querySelector(".standing-bar-fill") as HTMLElement;
    expect(fill).not.toBeNull();
    const w = fill.style.width;
    expect(w).not.toBe("NaN%");
    expect(w).toBe("100%");
  });

  it("renders skeleton while loading", () => {
    mockUseMe.mockReturnValue({ data: undefined, isLoading: true });
    mockUseLeaderboard.mockReturnValue({
      data: undefined, isLoading: true, isError: false,
    } as unknown as ReturnType<typeof useLeaderboard>);

    const { container } = wrap(<StandingCard />);
    // aria-busy should be set on the standing element
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
  });
});
