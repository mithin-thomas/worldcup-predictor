import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PastRow } from "./PastRow";
import type { MatchDTO } from "../lib/matches";

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

describe("PastRow", () => {
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
    // Check the chip is rendered with miss class and 0 points
    const chip = screen.getByLabelText("0 points");
    expect(chip).toHaveClass("miss");
    // The pick <b> element contains "0–0" (split across text nodes)
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
    // Should render the null chip (dash)
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
    // home_score 2 > away_score 1 → home is winner
    const { container } = render(<PastRow match={baseMatch} />);
    const homeTeam = container.querySelector(".pr-team.home");
    const awayTeam = container.querySelector(".pr-team.away");
    expect(homeTeam).toHaveClass("w");
    expect(awayTeam).not.toHaveClass("w");
  });
});
