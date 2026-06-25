import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { PlayerCombobox } from "./PlayerCombobox";
import * as bonus from "../lib/bonus";

vi.mock("../lib/bonus", async (orig) => {
  const actual = await orig<typeof import("../lib/bonus")>();
  return { ...actual, usePlayerSearch: vi.fn(), useTeams: vi.fn() };
});

const mockSearch = (results: bonus.PlayerOption[], isFetching = false) =>
  vi.mocked(bonus.usePlayerSearch).mockReturnValue({
    data: results,
    isFetching,
  } as unknown as ReturnType<typeof bonus.usePlayerSearch>);

const mockTeams = (teams: bonus.TeamOption[]) =>
  vi.mocked(bonus.useTeams).mockReturnValue({
    data: teams,
  } as unknown as ReturnType<typeof bonus.useTeams>);

const noop = () => {};

beforeEach(() => {
  vi.clearAllMocks();
  mockTeams([{ id: 1, name: "Portugal", code: "POR" }]);
  mockSearch([]);
});

describe("PlayerCombobox", () => {
  it("shows the name+country hint as placeholder when no pick is set", () => {
    render(
      <PlayerCombobox
        comboboxKey="golden_ball"
        ariaLabel="Search players for Golden Ball"
        disabled={false}
        currentRefId={undefined}
        currentLabel={undefined}
        onSelect={noop}
      />,
    );
    expect(
      screen.getByPlaceholderText(/Cristiano Ronaldo .* Portugal/i),
    ).toBeInTheDocument();
  });

  it("shows the full country name (not just the code) in results", async () => {
    mockSearch([
      { id: 7, name: "Cristiano Ronaldo", team_code: "POR", position: "Offence" },
    ]);
    render(
      <PlayerCombobox
        comboboxKey="golden_boot"
        ariaLabel="Search players for Golden Boot"
        disabled={false}
        currentRefId={undefined}
        currentLabel={undefined}
        onSelect={noop}
      />,
    );
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "Ronaldo" } });
    await waitFor(() =>
      expect(screen.getByRole("option")).toHaveTextContent(/Portugal/),
    );
    const listbox = screen.getByRole("listbox");
    expect(listbox.parentElement).toBe(document.body);
    expect(listbox).toHaveStyle({ position: "fixed", zIndex: "90" });
    // The 3-letter code alone must not be the meta text
    expect(screen.getByRole("option")).not.toHaveTextContent(/\bPOR\b · Offence/);
  });
});
