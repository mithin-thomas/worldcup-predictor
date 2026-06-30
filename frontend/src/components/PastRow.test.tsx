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

// Default: loading=false, no data (not yet fetched — modal closed)
beforeEach(() => {
  mockUseMatchPredictions.mockReturnValue(
    makeQueryResult<MatchPredictionDTO[]>({ data: undefined, isLoading: false, isError: false }),
  );
});

// ── PastRow result-card assertions (v2 verdict + compare layout) ────────────
describe("PastRow — result card", () => {
  it("renders team names and score", () => {
    render(<PastRow match={baseMatch} />);
    expect(screen.getByText("Mexico")).toBeInTheDocument();
    expect(screen.getByText("South Africa")).toBeInTheDocument();
    // Final scoreline visible
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("shows a 'No prediction' verdict when no prediction set", () => {
    const { container } = render(<PastRow match={baseMatch} />);
    const verdict = container.querySelector(".pr-verdict");
    expect(verdict).toHaveClass("miss");
    expect(verdict).toHaveTextContent(/No prediction/i);
    // miss stripe on the row
    expect(container.querySelector(".past-row")).toHaveClass("miss");
  });

  it("shows 'Missed' verdict + the pick→final compare when prediction scores 0", () => {
    const m: MatchDTO = {
      ...baseMatch,
      prediction: { home_score: 0, away_score: 0, penalty_winner_team_id: null, points: 0, penalty_bonus: null },
    };
    const { container } = render(<PastRow match={m} />);
    const verdict = container.querySelector(".pr-verdict");
    expect(verdict).toHaveClass("miss");
    expect(verdict).toHaveTextContent(/Missed/i);
    // 0 points renders without a leading "+" (reserved for positive points)
    expect(verdict?.textContent).toMatch(/Missed\s*0$/);
    // Compare: my pick (not a hit) → final
    const mypick = container.querySelector(".pr-mypick");
    expect(mypick).not.toHaveClass("hit");
    expect(mypick?.textContent).toMatch(/0.?0/);
    expect(container.querySelector(".pr-final")?.textContent).toMatch(/2.?1/);
  });

  it("shows 'Right result' verdict with 'ok' class for a correct result", () => {
    const m: MatchDTO = {
      ...baseMatch,
      prediction: { home_score: 3, away_score: 1, penalty_winner_team_id: null, points: 3, penalty_bonus: null },
    };
    const { container } = render(<PastRow match={m} />);
    const verdict = container.querySelector(".pr-verdict");
    expect(verdict).toHaveClass("ok");
    expect(verdict).toHaveTextContent(/Right result/i);
    expect(verdict).toHaveTextContent("+3");
  });

  it("shows 'Exact score' verdict with 'win' class + hit pick for an exact score", () => {
    const m: MatchDTO = {
      ...baseMatch,
      prediction: { home_score: 2, away_score: 1, penalty_winner_team_id: null, points: 5, penalty_bonus: null },
    };
    const { container } = render(<PastRow match={m} />);
    const verdict = container.querySelector(".pr-verdict");
    expect(verdict).toHaveClass("win");
    expect(verdict).toHaveTextContent(/Exact score/i);
    expect(verdict).toHaveTextContent("+5");
    // Exact prediction → my pick is highlighted as a hit
    expect(container.querySelector(".pr-mypick")).toHaveClass("hit");
    expect(container.querySelector(".past-row")).toHaveClass("win");
  });

  it("shows 'Awaiting result' and 'vs' when the match is not yet scored", () => {
    const m: MatchDTO = {
      ...baseMatch,
      status: "live",
      home_score: null,
      away_score: null,
    };
    render(<PastRow match={m} />);
    expect(screen.getByText(/Awaiting result/i)).toBeInTheDocument();
    expect(screen.getByText("vs")).toBeInTheDocument();
  });

  it("shows the user's penalty winner pick while awaiting result", () => {
    const m: MatchDTO = {
      ...baseMatch,
      stage: "knockout",
      round: "Round of 16",
      group: "",
      status: "live",
      home_score: null,
      away_score: null,
      prediction: {
        home_score: 1,
        away_score: 1,
        penalty_winner_team_id: 2,
        points: null,
        penalty_bonus: null,
      },
    };

    render(<PastRow match={m} />);

    expect(screen.getByText(/Awaiting result/i)).toBeInTheDocument();
    const penaltyPick = screen.getByLabelText(/Penalty winner South Africa/i);
    expect(penaltyPick).toBeInTheDocument();
    expect(penaltyPick).toHaveTextContent(/Pens/);
    expect(penaltyPick).toHaveTextContent(/RSA/);
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

// ── Others' picks reveal — modal behaviour ──────────────────────────────────
describe("PastRow — others' picks modal", () => {
  it("renders a trigger button labelled 'Others' picks' with no modal initially", () => {
    render(<PastRow match={baseMatch} />);
    const btn = screen.getByRole("button", { name: /others' picks/i });
    expect(btn).toBeInTheDocument();
    // Modal not shown
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("trigger button has aria-expanded=false before modal opens", () => {
    render(<PastRow match={baseMatch} />);
    const btn = screen.getByRole("button", { name: /others' picks/i });
    expect(btn).toHaveAttribute("aria-expanded", "false");
  });

  it("useMatchPredictions is NOT called with enabled=true before modal opens", () => {
    render(<PastRow match={baseMatch} />);
    // Hook is called but with enabled=false when modal is closed
    expect(mockUseMatchPredictions).toHaveBeenCalledWith(1, false);
  });

  it("opens the modal (role=dialog) when the trigger is clicked", async () => {
    const user = userEvent.setup();
    mockUseMatchPredictions.mockReturnValue(
      makeQueryResult<MatchPredictionDTO[]>({ isLoading: true }),
    );

    render(<PastRow match={baseMatch} />);
    const btn = screen.getByRole("button", { name: /others' picks/i });
    await user.click(btn);

    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAttribute("aria-modal", "true");
  });

  it("trigger button has aria-expanded=true after modal opens", async () => {
    const user = userEvent.setup();
    mockUseMatchPredictions.mockReturnValue(
      makeQueryResult<MatchPredictionDTO[]>({ isLoading: true }),
    );

    render(<PastRow match={baseMatch} />);
    const btn = screen.getByRole("button", { name: /others' picks/i });
    await user.click(btn);

    expect(btn).toHaveAttribute("aria-expanded", "true");
  });

  it("calls useMatchPredictions with enabled=true after modal opens", async () => {
    const user = userEvent.setup();
    mockUseMatchPredictions.mockReturnValue(
      makeQueryResult<MatchPredictionDTO[]>({ isLoading: true }),
    );

    render(<PastRow match={baseMatch} />);
    await user.click(screen.getByRole("button", { name: /others' picks/i }));

    expect(mockUseMatchPredictions).toHaveBeenCalledWith(1, true);
  });

  it("modal title includes team names", async () => {
    const user = userEvent.setup();
    mockUseMatchPredictions.mockReturnValue(
      makeQueryResult<MatchPredictionDTO[]>({ isLoading: true }),
    );

    render(<PastRow match={baseMatch} />);
    await user.click(screen.getByRole("button", { name: /others' picks/i }));

    expect(screen.getByRole("heading", { name: /Mexico/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /South Africa/i })).toBeInTheDocument();
  });

  it("modal has an accessible close button", async () => {
    const user = userEvent.setup();
    mockUseMatchPredictions.mockReturnValue(
      makeQueryResult<MatchPredictionDTO[]>({ isLoading: true }),
    );

    render(<PastRow match={baseMatch} />);
    await user.click(screen.getByRole("button", { name: /others' picks/i }));

    expect(screen.getByRole("button", { name: /close/i })).toBeInTheDocument();
  });

  it("closes the modal when the close button is clicked", async () => {
    const user = userEvent.setup();
    mockUseMatchPredictions.mockReturnValue(
      makeQueryResult<MatchPredictionDTO[]>({ isLoading: true }),
    );

    render(<PastRow match={baseMatch} />);
    await user.click(screen.getByRole("button", { name: /others' picks/i }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /close/i }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes the modal when Escape is pressed", async () => {
    const user = userEvent.setup();
    mockUseMatchPredictions.mockReturnValue(
      makeQueryResult<MatchPredictionDTO[]>({ isLoading: true }),
    );

    render(<PastRow match={baseMatch} />);
    await user.click(screen.getByRole("button", { name: /others' picks/i }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes the modal when backdrop is clicked", async () => {
    const user = userEvent.setup();
    mockUseMatchPredictions.mockReturnValue(
      makeQueryResult<MatchPredictionDTO[]>({ isLoading: true }),
    );

    render(<PastRow match={baseMatch} />);
    await user.click(screen.getByRole("button", { name: /others' picks/i }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    // Click the overlay element (the dialog itself, not the inner dialog card)
    const overlay = document.body.querySelector(".op-overlay") as HTMLElement;
    await user.click(overlay);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows a loading skeleton while fetching", async () => {
    const user = userEvent.setup();
    mockUseMatchPredictions.mockReturnValue(
      makeQueryResult<MatchPredictionDTO[]>({ isLoading: true }),
    );

    render(<PastRow match={baseMatch} />);
    await user.click(screen.getByRole("button", { name: /others' picks/i }));

    const skeletons = document.body.querySelectorAll(".op-row--skeleton");
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

    render(<PastRow match={baseMatch} />);
    await user.click(screen.getByRole("button", { name: /others' picks/i }));

    // Scoreline elements should exist with mono class
    const scoreEls = document.body.querySelectorAll(".op-score");
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

  it("shows an error message inside the modal when the fetch fails", async () => {
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

    render(<PastRow match={baseMatch} />);
    await user.click(screen.getByRole("button", { name: /others' picks/i }));

    const meRow = document.body.querySelector(".op-row--me");
    expect(meRow).toBeInTheDocument();
    // The "You" tag should be inside the me-row
    expect(meRow?.textContent).toMatch(/\(You\)/);
  });

  it("shows count in the trigger button label once data is loaded and modal is closed", async () => {
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
    // Open the modal
    await user.click(screen.getByRole("button", { name: /others' picks/i }));
    // Close via the close button
    await user.click(screen.getByRole("button", { name: /close/i }));
    // Trigger label now shows count
    expect(
      screen.getByRole("button", { name: /others' picks \(3\)/i }),
    ).toBeInTheDocument();
  });

  it("modal is labelled with aria-labelledby pointing to the title", async () => {
    const user = userEvent.setup();
    mockUseMatchPredictions.mockReturnValue(
      makeQueryResult<MatchPredictionDTO[]>({ isLoading: true }),
    );

    render(<PastRow match={baseMatch} />);
    await user.click(screen.getByRole("button", { name: /others' picks/i }));

    const dialog = screen.getByRole("dialog");
    const labelledBy = dialog.getAttribute("aria-labelledby");
    expect(labelledBy).toBeTruthy();
    const titleEl = document.getElementById(labelledBy!);
    expect(titleEl).toBeInTheDocument();
    expect(titleEl?.textContent).toMatch(/others' picks/i);
  });
});
