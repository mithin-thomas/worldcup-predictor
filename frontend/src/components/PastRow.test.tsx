import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { UseQueryResult } from "@tanstack/react-query";
import { PastRow } from "./PastRow";
import type { MatchDTO, MatchPredictionDTO } from "../lib/matches";

// ── Mock useMatchPredictions so tests don't fire real HTTP ──────────────────
// We keep the rest of the module (types, etc.) real.
vi.mock("../lib/matches", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/matches")>();
  return {
    ...actual,
    useMatchPredictions: vi.fn(),
  };
});

// Import the mock AFTER vi.mock is hoisted
import { useMatchPredictions } from "../lib/matches";
const mockUseMatchPredictions = useMatchPredictions as ReturnType<typeof vi.fn>;

// ── Helpers ─────────────────────────────────────────────────────────────────
function makeQueryResult<T>(
  overrides: Partial<UseQueryResult<T>>,
): UseQueryResult<T> {
  return {
    data: undefined,
    isLoading: false,
    isFetching: false,
    isPending: false,
    isError: false,
    isSuccess: false,
    error: null,
    status: "pending",
    fetchStatus: "idle",
    isRefetching: false,
    isStale: false,
    isPlaceholderData: false,
    dataUpdatedAt: 0,
    errorUpdatedAt: 0,
    failureCount: 0,
    failureReason: null,
    refetch: vi.fn(),
    ...overrides,
  } as unknown as UseQueryResult<T>;
}

// ── Fixtures ─────────────────────────────────────────────────────────────────
const baseMatch: MatchDTO = {
  id: 1,
  match_number: 1,
  stage: "group",
  round: "Group Stage",
  group: "A",
  label: "Group A",
  kickoff_utc: "2026-06-20T00:00:00Z",
  kickoff_ist: "2026-06-20T05:30:00+05:30",
  status: "final",
  locked: true,
  home: { id: 1, name: "Mexico", code: "MEX" },
  away: { id: 2, name: "South Africa", code: "RSA" },
  venue: { name: "Estadio Azteca", city: "Mexico City", country: "Mexico" },
  home_score: 2,
  away_score: 1,
  prediction: null,
};

const samplePredictions: MatchPredictionDTO[] = [
  {
    user_id: 10,
    name: "Alice",
    avatar_url: "",
    home_score: 2,
    away_score: 1,
    penalty_winner_team_id: null,
    points: 5,
    penalty_bonus: null,
    is_me: false,
  },
  {
    user_id: 1,
    name: "Me",
    avatar_url: "",
    home_score: 1,
    away_score: 0,
    penalty_winner_team_id: null,
    points: 3,
    penalty_bonus: null,
    is_me: true,
  },
  {
    user_id: 11,
    name: "Bob",
    avatar_url: "",
    home_score: 0,
    away_score: 2,
    penalty_winner_team_id: null,
    points: 0,
    penalty_bonus: null,
    is_me: false,
  },
];

// Default: loading=false, no data (not yet fetched — closed)
beforeEach(() => {
  mockUseMatchPredictions.mockReturnValue(
    makeQueryResult<MatchPredictionDTO[]>({ data: undefined, isLoading: false, isError: false }),
  );
});

// ── Existing PastRow assertions (must keep passing) ─────────────────────────
describe("PastRow — existing behaviour", () => {
  it("renders team names and score", () => {
    render(<PastRow match={baseMatch} />);
    expect(screen.getByText("Mexico")).toBeInTheDocument();
    expect(screen.getByText("South Africa")).toBeInTheDocument();
    // Score visible
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("shows 'No prediction' when no prediction set", () => {
    render(<PastRow match={baseMatch} />);
    expect(screen.getByText(/No prediction/i)).toBeInTheDocument();
  });

  it("shows pick and +0 pts chip when prediction has 0 points", () => {
    const m: MatchDTO = {
      ...baseMatch,
      prediction: { home_score: 0, away_score: 0, penalty_winner_team_id: null, points: 0, penalty_bonus: null },
    };
    render(<PastRow match={m} />);
    expect(screen.getByText(/Your pick/i)).toBeInTheDocument();
    const chip = screen.getByLabelText("0 points");
    expect(chip).toHaveClass("miss");
    const bold = document.querySelector(".pr-pick b");
    expect(bold?.textContent).toMatch(/0/);
  });

  it("shows +3 pts chip with 'ok' class for correct result", () => {
    const m: MatchDTO = {
      ...baseMatch,
      prediction: { home_score: 3, away_score: 1, penalty_winner_team_id: null, points: 3, penalty_bonus: null },
    };
    render(<PastRow match={m} />);
    const chip = screen.getByLabelText("3 points");
    expect(chip).toHaveClass("ok");
    expect(chip).toHaveTextContent("+3 pts");
  });

  it("shows +5 pts chip with 'win' class for exact score", () => {
    const m: MatchDTO = {
      ...baseMatch,
      prediction: { home_score: 2, away_score: 1, penalty_winner_team_id: null, points: 5, penalty_bonus: null },
    };
    render(<PastRow match={m} />);
    const chip = screen.getByLabelText("5 points");
    expect(chip).toHaveClass("win");
    expect(chip).toHaveTextContent("+5 pts");
  });

  it("shows '—' chip when points is null (not yet scored)", () => {
    const m: MatchDTO = {
      ...baseMatch,
      prediction: { home_score: 2, away_score: 1, penalty_winner_team_id: null, points: null, penalty_bonus: null },
    };
    render(<PastRow match={m} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("surfaces +1 PEN bonus when penalty_bonus > 0", () => {
    const m: MatchDTO = {
      ...baseMatch,
      prediction: { home_score: 1, away_score: 1, penalty_winner_team_id: 1, points: 3, penalty_bonus: 1 },
    };
    render(<PastRow match={m} />);
    expect(screen.getByText(/\+1 PEN/i)).toBeInTheDocument();
  });

  it("applies winner team styling (w class) correctly", () => {
    const { container } = render(<PastRow match={baseMatch} />);
    const homeTeam = container.querySelector(".pr-team.home");
    const awayTeam = container.querySelector(".pr-team.away");
    expect(homeTeam).toHaveClass("w");
    expect(awayTeam).not.toHaveClass("w");
  });
});

// ── Others' picks reveal — new behaviour ────────────────────────────────────
describe("PastRow — others' picks reveal", () => {
  it("renders a toggle button with aria-expanded=false by default", () => {
    render(<PastRow match={baseMatch} />);
    const btn = screen.getByRole("button", { name: /others' picks/i });
    expect(btn).toBeInTheDocument();
    expect(btn).toHaveAttribute("aria-expanded", "false");
    // Panel is not visible yet
    expect(screen.queryByRole("list", { name: /others' predictions/i })).toBeNull();
  });

  it("useMatchPredictions is NOT called before the panel is opened", () => {
    render(<PastRow match={baseMatch} />);
    // Hook is called on every render but enabled=false when closed
    expect(mockUseMatchPredictions).toHaveBeenCalledWith(1, false);
  });

  it("opens the panel and calls useMatchPredictions with enabled=true on click", async () => {
    const user = userEvent.setup();
    mockUseMatchPredictions
      .mockReturnValueOnce(
        makeQueryResult<MatchPredictionDTO[]>({ isLoading: true }),
      )
      .mockReturnValue(
        makeQueryResult<MatchPredictionDTO[]>({
          data: samplePredictions,
          isLoading: false,
          isSuccess: true,
          status: "success",
        }),
      );

    render(<PastRow match={baseMatch} />);
    const btn = screen.getByRole("button", { name: /others' picks/i });
    await user.click(btn);

    expect(btn).toHaveAttribute("aria-expanded", "true");
    // enabled=true was passed after click
    expect(mockUseMatchPredictions).toHaveBeenCalledWith(1, true);
  });

  it("shows a loading skeleton while fetching", async () => {
    const user = userEvent.setup();
    mockUseMatchPredictions.mockReturnValue(
      makeQueryResult<MatchPredictionDTO[]>({ isLoading: true }),
    );

    const { container } = render(<PastRow match={baseMatch} />);
    await user.click(screen.getByRole("button", { name: /others' picks/i }));

    const skeletons = container.querySelectorAll(".op-row--skeleton");
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it("shows all predictions and '(You)' tag for the current user after loading", async () => {
    const user = userEvent.setup();
    mockUseMatchPredictions.mockReturnValue(
      makeQueryResult<MatchPredictionDTO[]>({
        data: samplePredictions,
        isLoading: false,
        isSuccess: true,
        status: "success",
      }),
    );

    render(<PastRow match={baseMatch} />);
    await user.click(screen.getByRole("button", { name: /others' picks/i }));

    // All names visible
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();

    // Current user marked with (You)
    expect(screen.getByText("(You)")).toBeInTheDocument();
  });

  it("shows scorelines in mono for each player", async () => {
    const user = userEvent.setup();
    mockUseMatchPredictions.mockReturnValue(
      makeQueryResult<MatchPredictionDTO[]>({
        data: samplePredictions,
        isLoading: false,
        isSuccess: true,
        status: "success",
      }),
    );

    const { container } = render(<PastRow match={baseMatch} />);
    await user.click(screen.getByRole("button", { name: /others' picks/i }));

    // Scoreline elements should exist with mono class
    const scoreEls = container.querySelectorAll(".op-score");
    expect(scoreEls.length).toBe(samplePredictions.length);
  });

  it("shows points chips for a FINAL match (points != null)", async () => {
    const user = userEvent.setup();
    mockUseMatchPredictions.mockReturnValue(
      makeQueryResult<MatchPredictionDTO[]>({
        data: samplePredictions,
        isLoading: false,
        isSuccess: true,
        status: "success",
      }),
    );

    render(<PastRow match={baseMatch} />);
    await user.click(screen.getByRole("button", { name: /others' picks/i }));

    // Alice: 5pts win chip
    const alicePts = screen.getByLabelText("5 points");
    expect(alicePts).toHaveClass("win");

    // Me: 3pts ok chip
    const mePts = screen.getByLabelText("3 points");
    expect(mePts).toHaveClass("ok");

    // Bob: 0pts miss chip
    const bobPts = screen.getByLabelText("0 points");
    expect(bobPts).toHaveClass("miss");
  });

  it("does NOT show points chips for an in-progress (locked but not final) match", async () => {
    const user = userEvent.setup();
    // In-progress: points = null
    const inProgressPredictions: MatchPredictionDTO[] = samplePredictions.map((p) => ({
      ...p,
      points: null,
      penalty_bonus: null,
    }));

    mockUseMatchPredictions.mockReturnValue(
      makeQueryResult<MatchPredictionDTO[]>({
        data: inProgressPredictions,
        isLoading: false,
        isSuccess: true,
        status: "success",
      }),
    );

    const inProgressMatch: MatchDTO = {
      ...baseMatch,
      status: "live",
      home_score: null,
      away_score: null,
    };

    render(<PastRow match={inProgressMatch} />);
    await user.click(screen.getByRole("button", { name: /others' picks/i }));

    // pts-chip inside op-list should not be rendered (no aria-labels for N points)
    const opList = screen.getByRole("list", { name: /others' predictions/i });
    expect(opList.querySelectorAll(".pts-chip").length).toBe(0);
  });

  it("shows penalty winner code when penalty_winner_team_id is set", async () => {
    const user = userEvent.setup();
    const penPredictions: MatchPredictionDTO[] = [
      {
        user_id: 20,
        name: "Carlos",
        avatar_url: "",
        home_score: 1,
        away_score: 1,
        penalty_winner_team_id: 1, // home = Mexico (MEX)
        points: 3,
        penalty_bonus: 1,
        is_me: false,
      },
    ];

    mockUseMatchPredictions.mockReturnValue(
      makeQueryResult<MatchPredictionDTO[]>({
        data: penPredictions,
        isLoading: false,
        isSuccess: true,
        status: "success",
      }),
    );

    render(<PastRow match={baseMatch} />);
    await user.click(screen.getByRole("button", { name: /others' picks/i }));

    // Should show "· pens: MEX"
    expect(screen.getByText(/pens: MEX/i)).toBeInTheDocument();
  });

  it("shows an inline error message when the fetch fails", async () => {
    const user = userEvent.setup();
    mockUseMatchPredictions.mockReturnValue(
      makeQueryResult<MatchPredictionDTO[]>({
        isError: true,
        error: new Error("Network error"),
      }),
    );

    render(<PastRow match={baseMatch} />);
    await user.click(screen.getByRole("button", { name: /others' picks/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
    expect(screen.getByText(/couldn't load predictions/i)).toBeInTheDocument();
  });

  it("shows empty state when there are no predictions", async () => {
    const user = userEvent.setup();
    mockUseMatchPredictions.mockReturnValue(
      makeQueryResult<MatchPredictionDTO[]>({
        data: [],
        isLoading: false,
        isSuccess: true,
        status: "success",
      }),
    );

    render(<PastRow match={baseMatch} />);
    await user.click(screen.getByRole("button", { name: /others' picks/i }));

    expect(screen.getByText(/no predictions for this match/i)).toBeInTheDocument();
  });

  it("collapses and shows 'Hide picks' text when open", async () => {
    const user = userEvent.setup();
    mockUseMatchPredictions.mockReturnValue(
      makeQueryResult<MatchPredictionDTO[]>({
        data: samplePredictions,
        isLoading: false,
        isSuccess: true,
        status: "success",
      }),
    );

    render(<PastRow match={baseMatch} />);
    const btn = screen.getByRole("button", { name: /others' picks/i });

    // Open
    await user.click(btn);
    expect(btn).toHaveAttribute("aria-expanded", "true");
    expect(btn).toHaveTextContent(/hide picks/i);

    // Close
    await user.click(btn);
    expect(btn).toHaveAttribute("aria-expanded", "false");
  });

  it("highlights the current user's row with op-row--me class", async () => {
    const user = userEvent.setup();
    mockUseMatchPredictions.mockReturnValue(
      makeQueryResult<MatchPredictionDTO[]>({
        data: samplePredictions,
        isLoading: false,
        isSuccess: true,
        status: "success",
      }),
    );

    const { container } = render(<PastRow match={baseMatch} />);
    await user.click(screen.getByRole("button", { name: /others' picks/i }));

    const meRow = container.querySelector(".op-row--me");
    expect(meRow).toBeInTheDocument();
    // The "You" tag should be inside the me-row
    expect(meRow?.textContent).toMatch(/\(You\)/);
  });

  it("shows count in the toggle button label once data is loaded and re-opened", async () => {
    const user = userEvent.setup();
    mockUseMatchPredictions.mockReturnValue(
      makeQueryResult<MatchPredictionDTO[]>({
        data: samplePredictions,
        isLoading: false,
        isSuccess: true,
        status: "success",
      }),
    );

    render(<PastRow match={baseMatch} />);
    await user.click(screen.getByRole("button", { name: /others' picks/i }));
    // Close it
    const btn = screen.getByRole("button", { name: /hide picks/i });
    await user.click(btn);
    // Label now shows count
    expect(
      screen.getByRole("button", { name: /others' picks \(3\)/i }),
    ).toBeInTheDocument();
  });
});
