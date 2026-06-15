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

const overallWithWinner = {
  period: "overall", page: 1, page_size: 20, total: 2,
  rows: [
    { rank: 1, user_id: 5, name: "Aaa", avatar_url: "", points: 18, exact: 3, correct: 1, is_winner: true, is_me: false },
    { rank: 2, user_id: 1, name: "Me", avatar_url: "", points: 12, exact: 1, correct: 3, is_winner: false, is_me: true },
  ],
  me: { rank: 2, points: 12 },
};

const weeklyWithWinner = {
  period: "week", page: 1, page_size: 20, total: 2,
  rows: [
    { rank: 1, user_id: 5, name: "Aaa", avatar_url: "", points: 18, exact: 3, correct: 1, is_winner: true, is_me: false },
    { rank: 2, user_id: 1, name: "Me", avatar_url: "", points: 12, exact: 1, correct: 3, is_winner: false, is_me: true },
  ],
  me: { rank: 2, points: 12 },
};

const paginatedOverall = {
  period: "overall", page: 1, page_size: 2, total: 5,
  rows: [
    { rank: 1, user_id: 5, name: "Aaa", avatar_url: "", points: 18, exact: 3, correct: 1, is_winner: false, is_me: false },
    { rank: 2, user_id: 6, name: "Bbb", avatar_url: "", points: 14, exact: 2, correct: 2, is_winner: false, is_me: false },
  ],
  me: { rank: 4, points: 8 },
};

afterEach(() => vi.restoreAllMocks());

describe("LeaderboardPanel", () => {
  it("renders ranked rows and highlights the current user (data-me attr)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => overall }));
    renderPanel();
    await screen.findByText("Aaa");
    const meRow = screen.getByText("Me").closest("[data-me]");
    expect(meRow).not.toBeNull();
    expect(screen.getByText("18")).toBeInTheDocument();
  });

  it("applies .you class to the current user's row", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => overall }));
    renderPanel();
    await screen.findByText("Me");
    // The li with data-me should have class "you"
    const meEl = document.querySelector("[data-me]");
    expect(meEl).not.toBeNull();
    expect(meEl!.classList.contains("you")).toBe(true);
  });

  it("renders 'You' tag inside the me row", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => overall }));
    renderPanel();
    await screen.findByText("Me");
    expect(screen.getByText("You")).toBeInTheDocument();
  });

  it("switches to Weekly when the toggle is clicked", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => overall });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderPanel();
    await screen.findByText("Aaa");
    await user.click(screen.getByRole("radio", { name: /weekly/i }));
    await waitFor(() => {
      const calledWeek = fetchMock.mock.calls.some(([url]) => String(url).includes("period=week"));
      expect(calledWeek).toBe(true);
    });
  });

  it("does NOT render the ★ winner badge on the Overall tab even when is_winner is true", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => overallWithWinner }));
    renderPanel();
    await screen.findByText("Aaa");
    expect(screen.queryByLabelText("weekly winner")).toBeNull();
  });

  it("shows ★ winner badge on the Weekly tab when is_winner is true", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      const isWeek = String(url).includes("period=week");
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => isWeek ? weeklyWithWinner : overall,
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderPanel();
    // Switch to weekly
    await screen.findByText("Aaa");
    await user.click(screen.getByRole("radio", { name: /weekly/i }));
    // wait for winner badge
    await screen.findByLabelText("weekly winner");
    expect(screen.getByLabelText("weekly winner")).toBeInTheDocument();
  });

  it("applies r1/r2/r3 classes to top-3 rank chips on overall", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => overall }));
    renderPanel();
    await screen.findByText("Aaa");
    const r1 = document.querySelector(".lb-rank.r1");
    expect(r1).not.toBeNull();
    const r2 = document.querySelector(".lb-rank.r2");
    expect(r2).not.toBeNull();
  });

  it("shows off-page 'Your rank' line when me is not in current page", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => paginatedOverall }));
    renderPanel();
    await screen.findByText("Aaa");
    expect(screen.getByText(/Your rank: 4/)).toBeInTheDocument();
  });

  it("renders Prev/Next pagination when total > page_size", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => paginatedOverall }));
    renderPanel();
    await screen.findByText("Aaa");
    expect(screen.getByLabelText("Previous page")).toBeInTheDocument();
    expect(screen.getByLabelText("Next page")).toBeInTheDocument();
  });

  it("period swap resets page to 1", async () => {
    // We use a multi-page dataset so page > 1 can be reached
    const page2 = {
      period: "overall", page: 2, page_size: 2, total: 5,
      rows: [
        { rank: 3, user_id: 7, name: "Ccc", avatar_url: "", points: 10, exact: 1, correct: 2, is_winner: false, is_me: false },
      ],
      me: { rank: 3, points: 10 },
    };

    const fetchMock = vi.fn().mockImplementation((url: string) => {
      const u = String(url);
      if (u.includes("page=2")) return Promise.resolve({ ok: true, status: 200, json: async () => page2 });
      return Promise.resolve({ ok: true, status: 200, json: async () => paginatedOverall });
    });
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    renderPanel();
    await screen.findByText("Aaa");

    // Navigate to page 2
    await user.click(screen.getByLabelText("Next page"));
    await screen.findByText("Ccc");
    // Verify we're on page 2
    expect(screen.getByText(/2 \/ 3/)).toBeInTheDocument();

    // Switch period → page must reset to 1
    await user.click(screen.getByRole("radio", { name: /weekly/i }));
    await waitFor(() => {
      const calls = fetchMock.mock.calls.map(([u]) => String(u));
      const weeklyPage1 = calls.some((u) => u.includes("period=week") && u.includes("page=1"));
      expect(weeklyPage1).toBe(true);
    });
    // And we should NOT see a page=2 request for the weekly period
    const weeklyPage2Calls = fetchMock.mock.calls
      .map(([u]) => String(u))
      .filter((u) => u.includes("period=week") && u.includes("page=2"));
    expect(weeklyPage2Calls.length).toBe(0);
  });
});
