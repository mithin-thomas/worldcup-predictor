import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LeaderboardPanel } from "./LeaderboardPanel";

function renderPanel() {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <LeaderboardPanel />
    </QueryClientProvider>,
  );
}

const overall = {
  period: "overall", page: 1, page_size: 20, total: 2,
  rows: [
    { rank: 1, user_id: 5, name: "Aaa", avatar_url: "", points: 18, exact: 3, correct: 1, is_winner: false, is_me: false },
    { rank: 2, user_id: 1, name: "Me", avatar_url: "", points: 12, exact: 1, correct: 3, is_winner: false, is_me: true },
  ],
  me: { rank: 2, points: 12 },
};

afterEach(() => vi.restoreAllMocks());

describe("LeaderboardPanel", () => {
  it("renders ranked rows and highlights the current user", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => overall }));
    renderPanel();
    await screen.findByText("Aaa");
    const meRow = screen.getByText("Me").closest("[data-me]");
    expect(meRow).not.toBeNull();
    expect(screen.getByText("18")).toBeInTheDocument();
  });

  it("switches to Weekly when the toggle is clicked", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => overall });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderPanel();
    await screen.findByText("Aaa");
    await user.click(screen.getByRole("button", { name: /weekly/i }));
    await waitFor(() => {
      const calledWeek = fetchMock.mock.calls.some(([url]) => String(url).includes("period=week"));
      expect(calledWeek).toBe(true);
    });
  });
});
