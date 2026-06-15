import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MatchCard } from "./MatchCard";
import type { MatchDTO } from "../lib/matches";

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const baseMatch: MatchDTO = {
  id: 1,
  match_number: 1,
  stage: "group",
  round: "Group Stage",
  group: "A",
  label: "Group A",
  kickoff_utc: "2030-06-20T00:00:00Z",
  kickoff_ist: "2030-06-20T05:30:00+05:30",
  status: "scheduled",
  locked: false,
  home: { id: 1, name: "Mexico", code: "MEX" },
  away: { id: 2, name: "South Africa", code: "RSA" },
  venue: { name: "Estadio Azteca", city: "Mexico City", country: "Mexico" },
  home_score: null,
  away_score: null,
  prediction: null,
};

afterEach(() => vi.restoreAllMocks());

describe("MatchCard", () => {
  // ── New prediction (no existing pick) ───────────────────────────────────
  it("shows 'Save prediction' button for a new pick (no existing prediction)", () => {
    wrap(<MatchCard match={baseMatch} />);
    expect(screen.getByRole("button", { name: /save prediction/i })).toBeInTheDocument();
  });

  it("saves a new 0-0 prediction (always saveable)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ home_score: 0, away_score: 0, penalty_winner_team_id: null, points: null, penalty_bonus: null }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    wrap(<MatchCard match={baseMatch} />);

    const saveBtn = screen.getByRole("button", { name: /save prediction/i });
    expect(saveBtn).toBeEnabled();
    await user.click(saveBtn);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toContain("/matches/1/prediction");
    expect(opts.method).toBe("PUT");
    expect(JSON.parse(opts.body)).toMatchObject({ home_score: 0, away_score: 0 });
  });

  it("shows 'Update pick' when a prediction already exists and score changes", async () => {
    const withPick: MatchDTO = {
      ...baseMatch,
      prediction: { home_score: 1, away_score: 0, penalty_winner_team_id: null, points: null, penalty_bonus: null },
    };
    const user = userEvent.setup();
    wrap(<MatchCard match={withPick} />);

    // Initially not dirty — should show ghost/disabled save (aria-label: "Update prediction")
    const saveBtn = screen.getByRole("button", { name: /update (pick|prediction)/i });
    expect(saveBtn).toBeDisabled();

    // Increase home score → dirty
    await user.click(screen.getByRole("button", { name: /increase mexico/i }));
    expect(screen.getByRole("button", { name: /update (pick|prediction)/i })).toBeEnabled();
  });

  // ── Locked state ─────────────────────────────────────────────────────────
  it("renders locked state read-only when match.locked=true", () => {
    wrap(<MatchCard match={{ ...baseMatch, locked: true }} />);
    // Locked pill present
    expect(screen.getByText("Locked")).toBeInTheDocument();
    // Steppers should not be visible (read-only locked state)
    expect(screen.queryByRole("button", { name: /increase mexico/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /save prediction/i })).toBeNull();
    // Shows "Pick locked · —" (no prediction)
    expect(screen.getByText(/pick locked/i)).toBeInTheDocument();
  });

  it("shows locked pick score when match is locked with a prediction", () => {
    wrap(<MatchCard match={{
      ...baseMatch,
      locked: true,
      prediction: { home_score: 2, away_score: 1, penalty_winner_team_id: null, points: 5, penalty_bonus: null },
    }} />);
    expect(screen.getByText(/2.+1/)).toBeInTheDocument(); // "Pick locked · 2–1"
  });

  // ── Server 409 lock ───────────────────────────────────────────────────────
  it("shows lock alert and disables save on server 409", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ error: "match is locked" }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    wrap(<MatchCard match={baseMatch} />);

    await user.click(screen.getByRole("button", { name: /save prediction/i }));
    await screen.findByRole("alert");
    expect(screen.getByRole("alert")).toHaveTextContent(/locked at kickoff/i);
  });

  // ── Saved flash ───────────────────────────────────────────────────────────
  it("shows 'Saved' flash after successful save", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ home_score: 0, away_score: 0, penalty_winner_team_id: null, points: null, penalty_bonus: null }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    wrap(<MatchCard match={baseMatch} />);

    await user.click(screen.getByRole("button", { name: /save prediction/i }));
    await waitFor(() => expect(screen.queryByText(/Saved/i)).toBeInTheDocument());
  });

  // ── TBD match ─────────────────────────────────────────────────────────────
  it("renders TBD matches non-editable (no stepper, no save button)", () => {
    wrap(<MatchCard match={{ ...baseMatch, home: null, away: null, label: "W74 vs W77", stage: "knockout" }} />);
    expect(screen.getByText("W74 vs W77")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /increase/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /save prediction/i })).toBeNull();
  });

  // ── Knockout penalty control ───────────────────────────────────────────────
  it("shows shootout-winner control on knockout draw", () => {
    const ko: MatchDTO = {
      ...baseMatch,
      id: 90,
      stage: "knockout",
      round: "Round of 16",
      group: "",
      label: "Round of 16",
      home: { id: 1, name: "Brazil", code: "BRA" },
      away: { id: 2, name: "Spain", code: "ESP" },
    };
    wrap(<MatchCard match={ko} />);
    // Default 0-0 → draw → penalty control visible
    expect(screen.getByRole("group", { name: /shootout winner/i })).toBeInTheDocument();
  });

  it("hides shootout-winner control when score is not a draw", async () => {
    const ko: MatchDTO = {
      ...baseMatch,
      id: 90,
      stage: "knockout",
      round: "Round of 16",
      group: "",
      label: "Round of 16",
      home: { id: 1, name: "Brazil", code: "BRA" },
      away: { id: 2, name: "Spain", code: "ESP" },
    };
    const user = userEvent.setup();
    wrap(<MatchCard match={ko} />);

    // Initially a draw (0-0) → visible
    expect(screen.getByRole("group", { name: /shootout winner/i })).toBeInTheDocument();

    // Increase Brazil score → 1-0 → no longer a draw
    await user.click(screen.getByRole("button", { name: /increase brazil/i }));
    expect(screen.queryByRole("group", { name: /shootout winner/i })).toBeNull();
  });

  it("sends penalty_winner_team_id in payload on knockout draw", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ home_score: 0, away_score: 0, penalty_winner_team_id: 2, points: null, penalty_bonus: null }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    const ko: MatchDTO = {
      ...baseMatch,
      id: 90,
      stage: "knockout",
      round: "Round of 16",
      group: "",
      label: "Round of 16",
      home: { id: 1, name: "Brazil", code: "BRA" },
      away: { id: 2, name: "Spain", code: "ESP" },
    };
    wrap(<MatchCard match={ko} />);

    // Pick Spain as shootout winner
    const penGroup = screen.getByRole("group", { name: /shootout winner/i });
    await user.click(penGroup.querySelector("button[aria-pressed]")?.nextElementSibling as HTMLElement
      ?? screen.getByRole("button", { name: "ESP" }));
    await user.click(screen.getByRole("button", { name: /save prediction/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.penalty_winner_team_id).toBe(2);
  });
});
