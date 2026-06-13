import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MatchRow } from "./MatchRow";
import type { MatchDTO } from "../lib/matches";

function renderRow(match: MatchDTO) {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <MatchRow match={match} />
    </QueryClientProvider>,
  );
}

const baseGroup: MatchDTO = {
  id: 1, match_number: 1, stage: "group", round: "Group Stage", group: "A", label: "Group A",
  kickoff_utc: "2030-06-20T00:00:00Z", kickoff_ist: "2030-06-20T05:30:00+05:30",
  status: "scheduled", locked: false,
  home: { id: 1, name: "Mexico", code: "MEX" }, away: { id: 2, name: "South Africa", code: "RSA" },
  venue: { name: "Estadio Azteca", city: "Mexico City", country: "Mexico" },
  home_score: null, away_score: null, prediction: null,
};

afterEach(() => vi.restoreAllMocks());

describe("MatchRow editor", () => {
  it("expands on tap and saves the entered score", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ home_score: 1, away_score: 0, penalty_winner_team_id: null }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderRow(baseGroup);

    await user.click(screen.getByRole("button", { name: /predict|edit/i }));
    const editor = screen.getByRole("group", { name: /your prediction/i });
    await user.click(within(editor).getByRole("button", { name: /increase mexico/i }));
    await user.click(within(editor).getByRole("button", { name: /save prediction/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toContain("/matches/1/prediction");
    expect(opts.method).toBe("PUT");
    expect(JSON.parse(opts.body)).toMatchObject({ home_score: 1, away_score: 0 });
  });

  it("sends the picked shootout winner on a knockout draw", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ home_score: 1, away_score: 1, penalty_winner_team_id: 2 }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    const ko: MatchDTO = {
      ...baseGroup, id: 90, stage: "knockout", round: "Round of 16", group: "", label: "Round of 16",
      home: { id: 1, name: "Brazil", code: "BRA" }, away: { id: 2, name: "Spain", code: "ESP" },
    };
    renderRow(ko);

    await user.click(screen.getByRole("button", { name: /predict|edit/i }));
    const editor = screen.getByRole("group", { name: /your prediction/i });
    // 0-0 default is a draw → shootout control visible; pick the away team (Spain, id 2).
    await user.click(within(screen.getByRole("group", { name: /shootout winner/i })).getByRole("button", { name: "ESP" }));
    await user.click(within(editor).getByRole("button", { name: /save prediction/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ home_score: 0, away_score: 0, penalty_winner_team_id: 2 });
  });

  it("renders a locked match read-only with no Save button", () => {
    renderRow({ ...baseGroup, locked: true, prediction: { home_score: 2, away_score: 1, penalty_winner_team_id: null } });
    expect(screen.queryByRole("button", { name: /save prediction/i })).toBeNull();
    expect(screen.getByText(/2\s*[–-]\s*1/)).toBeInTheDocument();
  });

  it("shows the penalty-winner control only on a knockout draw", async () => {
    const user = userEvent.setup();
    const ko: MatchDTO = {
      ...baseGroup, id: 90, stage: "knockout", round: "Round of 16", group: "", label: "Round of 16",
      home: { id: 1, name: "Brazil", code: "BRA" }, away: { id: 2, name: "Spain", code: "ESP" },
    };
    renderRow(ko);
    await user.click(screen.getByRole("button", { name: /predict|edit/i }));
    // 0-0 default is a draw → penalty control visible.
    expect(screen.getByRole("group", { name: /shootout winner/i })).toBeInTheDocument();

    // Make it 1-0 (not a draw) → control hidden.
    const editor = screen.getByRole("group", { name: /your prediction/i });
    await user.click(within(editor).getByRole("button", { name: /increase brazil/i }));
    expect(screen.queryByRole("group", { name: /shootout winner/i })).toBeNull();
  });

  it("flips the row to a locked state when the server returns 409", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ error: "match is locked" }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderRow(baseGroup);

    await user.click(screen.getByRole("button", { name: /predict|edit/i }));
    const editor = screen.getByRole("group", { name: /your prediction/i });
    await user.click(within(editor).getByRole("button", { name: /increase mexico/i }));
    await user.click(within(editor).getByRole("button", { name: /save prediction/i }));

    // The 409 surfaces a locked alert and disables Save.
    await screen.findByRole("alert");
    expect(screen.getByRole("alert")).toHaveTextContent(/locked/i);
    expect(within(editor).getByRole("button", { name: /save prediction/i })).toBeDisabled();
  });

  it("renders TBD matches non-editable", () => {
    renderRow({ ...baseGroup, id: 100, stage: "knockout", group: "", label: "W74 vs W77", home: null, away: null });
    expect(screen.queryByRole("button", { name: /predict|edit/i })).toBeNull();
    expect(screen.getByText("W74 vs W77")).toBeInTheDocument();
  });
});
