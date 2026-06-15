import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MatchesColumn } from "./MatchesColumn";
import type { MatchesResponse } from "../lib/matches";

// Mock the matches module so we control what getMatches returns
vi.mock("../lib/matches", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/matches")>();
  return { ...actual, getMatches: vi.fn() };
});

import { getMatches } from "../lib/matches";

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

// Factory helpers
const makeUpcoming = (id: number, overrides = {}) => ({
  id,
  match_number: id,
  stage: "group" as const,
  round: "Group Stage",
  group: "A",
  label: `Match ${id}`,
  kickoff_utc: "2030-06-20T00:00:00Z",
  kickoff_ist: "2030-06-20T05:30:00+05:30",
  status: "scheduled" as const,
  locked: false,
  home: { id: 1, name: "Mexico", code: "MEX" },
  away: { id: 2, name: "Canada", code: "CAN" },
  venue: { name: "Stadium", city: "City", country: "USA" },
  home_score: null,
  away_score: null,
  prediction: null,
  ...overrides,
});

const makeFinal = (id: number) => ({
  ...makeUpcoming(id),
  status: "final" as const,
  locked: true,
  home_score: 2,
  away_score: 1,
  kickoff_ist: `2026-06-1${id % 9}T05:30:00+05:30`,
  kickoff_utc: `2026-06-1${id % 9}T00:00:00Z`,
});

beforeEach(() => { vi.clearAllMocks(); });

describe("MatchesColumn", () => {
  it("renders loading skeleton while data is pending", () => {
    // Never resolves
    (getMatches as ReturnType<typeof vi.fn>).mockReturnValue(new Promise(() => {}));
    wrap(<MatchesColumn />);
    expect(screen.getByRole("region", { name: /loading matches/i })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: /loading matches/i })).toHaveAttribute("aria-busy", "true");
  });

  it("shows error state when fetch fails", async () => {
    (getMatches as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("network error"));
    wrap(<MatchesColumn />);
    await screen.findByRole("alert");
    expect(screen.getByRole("alert")).toHaveTextContent(/Could not load matches/i);
  });

  it("renders Upcoming matches by default", async () => {
    const data: MatchesResponse = {
      days: [{
        date: "2030-06-20",
        matches: [makeUpcoming(1), makeUpcoming(2)],
      }],
    };
    (getMatches as ReturnType<typeof vi.fn>).mockResolvedValue(data);
    wrap(<MatchesColumn />);

    await waitFor(() => expect(screen.getByRole("tab", { name: /upcoming/i })).toHaveAttribute("aria-selected", "true"));
    // Two upcoming MatchCards visible
    await waitFor(() => expect(screen.getAllByRole("article")).toHaveLength(2));
  });

  it("shows 'N matches need a pick' hint for unpredicted upcoming matches", async () => {
    const data: MatchesResponse = {
      days: [{
        date: "2030-06-20",
        matches: [
          makeUpcoming(1), // no prediction
          makeUpcoming(2, { prediction: { home_score: 1, away_score: 0, penalty_winner_team_id: null, points: null, penalty_bonus: null } }),
        ],
      }],
    };
    (getMatches as ReturnType<typeof vi.fn>).mockResolvedValue(data);
    wrap(<MatchesColumn />);

    await waitFor(() => expect(screen.getByText(/1 match needs a pick/i)).toBeInTheDocument());
  });

  it("shows only 6 matches initially and 'Load more' when there are more", async () => {
    // 8 upcoming matches
    const matches = Array.from({ length: 8 }, (_, i) => makeUpcoming(i + 1));
    const data: MatchesResponse = {
      days: [{ date: "2030-06-20", matches }],
    };
    (getMatches as ReturnType<typeof vi.fn>).mockResolvedValue(data);
    wrap(<MatchesColumn />);

    await waitFor(() => expect(screen.getAllByRole("article")).toHaveLength(6));
    expect(screen.getByText(/2 left/i)).toBeInTheDocument(); // load-more shows "2 left"
  });

  it("loads 6 more on 'Load more' click", async () => {
    const matches = Array.from({ length: 8 }, (_, i) => makeUpcoming(i + 1));
    const data: MatchesResponse = {
      days: [{ date: "2030-06-20", matches }],
    };
    (getMatches as ReturnType<typeof vi.fn>).mockResolvedValue(data);
    const user = userEvent.setup();
    wrap(<MatchesColumn />);

    await waitFor(() => expect(screen.getAllByRole("article")).toHaveLength(6));
    await user.click(screen.getByText(/Load more/i));
    await waitFor(() => expect(screen.getAllByRole("article")).toHaveLength(8));
    expect(screen.queryByText(/Load more/i)).toBeNull();
  });

  it("switches to Past & results view and shows final matches", async () => {
    const data: MatchesResponse = {
      days: [
        { date: "2026-06-10", matches: [makeFinal(1), makeFinal(2)] },
        { date: "2026-06-11", matches: [makeUpcoming(3)] },
      ],
    };
    (getMatches as ReturnType<typeof vi.fn>).mockResolvedValue(data);
    const user = userEvent.setup();
    wrap(<MatchesColumn />);

    // Wait for data to load
    await waitFor(() => screen.getByRole("tab", { name: /upcoming/i }));

    // Switch to past
    await user.click(screen.getByRole("tab", { name: /past & results/i }));
    await waitFor(() => expect(screen.getByRole("tab", { name: /past & results/i })).toHaveAttribute("aria-selected", "true"));

    // Should show PastRow articles for the 2 final matches
    await waitFor(() => expect(screen.getAllByRole("article")).toHaveLength(2));
  });

  it("each view maintains its own pagination (switching views preserves their count)", async () => {
    // 8 final matches, 0 upcoming
    const finals = Array.from({ length: 8 }, (_, i) => makeFinal(i + 1));
    const data: MatchesResponse = {
      days: [{ date: "2026-06-10", matches: finals }],
    };
    (getMatches as ReturnType<typeof vi.fn>).mockResolvedValue(data);
    const user = userEvent.setup();
    wrap(<MatchesColumn />);

    await waitFor(() => screen.getByRole("tab", { name: /upcoming/i }));

    // Switch to past — starts at 6
    await user.click(screen.getByRole("tab", { name: /past & results/i }));
    await waitFor(() => expect(screen.getAllByRole("article")).toHaveLength(6));

    // Load more → 8 visible in past
    await user.click(screen.getByText(/Load more/i));
    await waitFor(() => expect(screen.getAllByRole("article")).toHaveLength(8));

    // Switch back to upcoming (empty)
    await user.click(screen.getByRole("tab", { name: /upcoming/i }));
    // Upcoming is empty — no articles
    await waitFor(() => expect(screen.queryAllByRole("article")).toHaveLength(0));
  });

  it("shows empty state when no upcoming matches", async () => {
    const data: MatchesResponse = {
      days: [{ date: "2026-06-10", matches: [makeFinal(1)] }],
    };
    (getMatches as ReturnType<typeof vi.fn>).mockResolvedValue(data);
    wrap(<MatchesColumn />);

    await waitFor(() => expect(screen.getByText(/No upcoming matches/i)).toBeInTheDocument());
  });
});
