import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LeaderboardPanel } from "./LeaderboardPanel";

function renderPanel() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <LeaderboardPanel />
    </QueryClientProvider>,
  );
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

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

// 2 rows total — total <= 5, so no "View all" button
const twoRows = {
  period: "overall", page: 1, page_size: 20, total: 2,
  rows: [
    { rank: 1, user_id: 5, name: "Aaa", avatar_url: "", points: 18, exact: 3, correct: 1, is_winner: false, is_me: false },
    { rank: 2, user_id: 1, name: "Me", avatar_url: "", points: 12, exact: 1, correct: 3, is_winner: false, is_me: true },
  ],
  me: { rank: 2, points: 12 },
};

// 6 rows on page 1 of 20 total — triggers "View all" button
const sixRows = {
  period: "overall", page: 1, page_size: 20, total: 6,
  rows: [
    { rank: 1, user_id: 5, name: "Aaa", avatar_url: "", points: 50, exact: 5, correct: 0, is_winner: false, is_me: false },
    { rank: 2, user_id: 6, name: "Bbb", avatar_url: "", points: 45, exact: 4, correct: 2, is_winner: false, is_me: false },
    { rank: 3, user_id: 7, name: "Ccc", avatar_url: "", points: 40, exact: 3, correct: 3, is_winner: false, is_me: false },
    { rank: 4, user_id: 8, name: "Ddd", avatar_url: "", points: 35, exact: 3, correct: 1, is_winner: false, is_me: false },
    { rank: 5, user_id: 9, name: "Eee", avatar_url: "", points: 30, exact: 2, correct: 2, is_winner: false, is_me: false },
    { rank: 6, user_id: 1, name: "Me",  avatar_url: "", points: 20, exact: 1, correct: 1, is_winner: false, is_me: true  },
  ],
  me: { rank: 6, points: 20 },
};

// Page 1 of a paginated 2-page response (page_size=3, total=6)
const modalPage1 = {
  period: "overall", page: 1, page_size: 3, total: 6,
  rows: [
    { rank: 1, user_id: 5, name: "Aaa", avatar_url: "", points: 50, exact: 5, correct: 0, is_winner: false, is_me: false },
    { rank: 2, user_id: 6, name: "Bbb", avatar_url: "", points: 45, exact: 4, correct: 2, is_winner: false, is_me: false },
    { rank: 3, user_id: 7, name: "Ccc", avatar_url: "", points: 40, exact: 3, correct: 3, is_winner: false, is_me: false },
  ],
  me: { rank: 6, points: 20 },
};

const modalPage2 = {
  period: "overall", page: 2, page_size: 3, total: 6,
  rows: [
    { rank: 4, user_id: 8, name: "Ddd", avatar_url: "", points: 35, exact: 3, correct: 1, is_winner: false, is_me: false },
    { rank: 5, user_id: 9, name: "Eee", avatar_url: "", points: 30, exact: 2, correct: 2, is_winner: false, is_me: false },
    { rank: 6, user_id: 1, name: "Me",  avatar_url: "", points: 20, exact: 1, correct: 1, is_winner: false, is_me: true  },
  ],
  me: { rank: 6, points: 20 },
};

const weekModalPage1 = {
  period: "week", page: 1, page_size: 3, total: 6,
  rows: [
    { rank: 1, user_id: 5, name: "Aaa", avatar_url: "", points: 18, exact: 3, correct: 1, is_winner: true, is_me: false },
    { rank: 2, user_id: 6, name: "Bbb", avatar_url: "", points: 14, exact: 2, correct: 2, is_winner: false, is_me: false },
    { rank: 3, user_id: 7, name: "Ccc", avatar_url: "", points: 10, exact: 1, correct: 3, is_winner: false, is_me: false },
  ],
  me: null,
};

// A fixture where user is NOT in top-5 rows (for off-page rank line)
const meBelowTop5 = {
  period: "overall", page: 1, page_size: 20, total: 8,
  rows: [
    { rank: 1, user_id: 5, name: "Aaa", avatar_url: "", points: 50, exact: 5, correct: 0, is_winner: false, is_me: false },
    { rank: 2, user_id: 6, name: "Bbb", avatar_url: "", points: 45, exact: 4, correct: 2, is_winner: false, is_me: false },
    { rank: 3, user_id: 7, name: "Ccc", avatar_url: "", points: 40, exact: 3, correct: 3, is_winner: false, is_me: false },
    { rank: 4, user_id: 8, name: "Ddd", avatar_url: "", points: 35, exact: 3, correct: 1, is_winner: false, is_me: false },
    { rank: 5, user_id: 9, name: "Eee", avatar_url: "", points: 30, exact: 2, correct: 2, is_winner: false, is_me: false },
  ],
  me: { rank: 7, points: 10 },
};

afterEach(() => vi.restoreAllMocks());

// ── Panel: core rendering ──────────────────────────────────────────────────

describe("LeaderboardPanel — core", () => {
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
    const meEl = document.querySelector("[data-me]");
    expect(meEl).not.toBeNull();
    expect(meEl!.classList.contains("you")).toBe(true);
  });

  it("marks the me row with a (You) label after the name", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => overall }));
    renderPanel();
    await screen.findByText("Me");
    expect(screen.getByText("(You)")).toBeInTheDocument();
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
    await screen.findByText("Aaa");
    await user.click(screen.getByRole("radio", { name: /weekly/i }));
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
});

// ── Panel: top-5 cap ──────────────────────────────────────────────────────

describe("LeaderboardPanel — top-5 cap", () => {
  it("renders at most 5 rows in the panel even when more are returned", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => sixRows }));
    renderPanel();
    // Wait for rows to appear
    await screen.findByText("Aaa");
    // Panel should show exactly 5 rows (Aaa through Eee), not the 6th (Me)
    const rows = document.querySelectorAll("section .lb-row");
    expect(rows.length).toBe(5);
    expect(screen.queryByText("Me")).toBeNull();
  });

  it("shows the off-page 'Your rank' line when me is NOT in the top 5", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => meBelowTop5 }));
    renderPanel();
    await screen.findByText("Aaa");
    expect(screen.getByText(/Your rank: 7/)).toBeInTheDocument();
  });

  it("does NOT show 'Your rank' line when me IS in the top 5", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => overall }));
    renderPanel();
    await screen.findByText("Me");
    expect(screen.queryByText(/Your rank:/)).toBeNull();
  });
});

// ── Panel: "View all" button ──────────────────────────────────────────────

describe("LeaderboardPanel — 'View all' button", () => {
  it("does NOT show 'View all' button when total <= 5", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => twoRows }));
    renderPanel();
    await screen.findByText("Aaa");
    expect(screen.queryByRole("button", { name: /view all/i })).toBeNull();
  });

  it("shows 'View all N players' button when total > 5", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => sixRows }));
    renderPanel();
    await screen.findByText("Aaa");
    const btn = screen.getByRole("button", { name: /view all 6 players/i });
    expect(btn).toBeInTheDocument();
  });
});

// ── Modal: open / close ───────────────────────────────────────────────────

describe("LeaderboardPanel — modal open/close", () => {
  it("clicking 'View all' opens the modal (role=dialog)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => sixRows }));
    const user = userEvent.setup();
    renderPanel();
    await screen.findByText("Aaa");
    await user.click(screen.getByRole("button", { name: /view all/i }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("pressing Escape closes the modal", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => sixRows }));
    const user = userEvent.setup();
    renderPanel();
    await screen.findByText("Aaa");
    await user.click(screen.getByRole("button", { name: /view all/i }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("clicking the close (✕) button closes the modal", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => sixRows }));
    const user = userEvent.setup();
    renderPanel();
    await screen.findByText("Aaa");
    await user.click(screen.getByRole("button", { name: /view all/i }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /close leaderboard/i }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("clicking the backdrop closes the modal", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => sixRows }));
    const user = userEvent.setup();
    renderPanel();
    await screen.findByText("Aaa");
    await user.click(screen.getByRole("button", { name: /view all/i }));
    const overlay = document.querySelector(".lbm-overlay") as HTMLElement;
    expect(overlay).not.toBeNull();
    // Click directly on the overlay (backdrop)
    await user.click(overlay);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

// ── Modal: content & pagination ───────────────────────────────────────────

describe("LeaderboardPanel — modal content & pagination", () => {
  it("modal shows rows and Prev/Next pagination when multiple pages exist", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      const u = String(url);
      if (u.includes("page=2") && u.includes("period=overall")) {
        return Promise.resolve({ ok: true, status: 200, json: async () => modalPage2 });
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => modalPage1 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderPanel();
    // Wait for panel to render with total=6 so "View all" appears
    await screen.findByText("Aaa");
    await user.click(screen.getByRole("button", { name: /view all/i }));

    // Modal opens — find rows on page 1
    const dialog = screen.getByRole("dialog");
    await within(dialog).findByText("Aaa");
    expect(within(dialog).getByText("Bbb")).toBeInTheDocument();
    expect(within(dialog).getByText("Ccc")).toBeInTheDocument();

    // Pagination buttons exist
    expect(within(dialog).getByLabelText("Previous page")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Next page")).toBeInTheDocument();

    // Navigate to page 2
    await user.click(within(dialog).getByLabelText("Next page"));
    await within(dialog).findByText("Ddd");
    expect(within(dialog).getByText("Eee")).toBeInTheDocument();
    // Me row appears on page 2 — inside the dialog
    expect(within(dialog).getByText("Me")).toBeInTheDocument();
  });

  it("(You) label is rendered in modal for the current user", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      const u = String(url);
      if (u.includes("page=2")) {
        return Promise.resolve({ ok: true, status: 200, json: async () => modalPage2 });
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => modalPage1 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderPanel();
    await screen.findByText("Aaa");
    await user.click(screen.getByRole("button", { name: /view all/i }));
    const dialog = screen.getByRole("dialog");
    await within(dialog).findByText("Aaa");
    // Navigate to page 2 to see the "Me" row
    await user.click(within(dialog).getByLabelText("Next page"));
    await within(dialog).findByText("Me");
    expect(within(dialog).getByText("(You)")).toBeInTheDocument();
  });

  it("modal period toggle switches to Weekly inside the modal", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      const u = String(url);
      if (u.includes("period=week")) {
        return Promise.resolve({ ok: true, status: 200, json: async () => weekModalPage1 });
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => modalPage1 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderPanel();
    await screen.findByText("Aaa");
    await user.click(screen.getByRole("button", { name: /view all/i }));
    const dialog = screen.getByRole("dialog");
    await within(dialog).findByText("Aaa");

    // Find the Weekly radio inside the dialog and click it
    const weeklyRadio = within(dialog).getAllByRole("radio", { name: /weekly/i })[0];
    await user.click(weeklyRadio);

    // Verify a fetch with period=week was made
    await waitFor(() => {
      const calledWeek = fetchMock.mock.calls.some(([url]) => String(url).includes("period=week"));
      expect(calledWeek).toBe(true);
    });
  });

  it("modal period change resets page to 1", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      const u = String(url);
      if (u.includes("page=2") && u.includes("period=overall")) {
        return Promise.resolve({ ok: true, status: 200, json: async () => modalPage2 });
      }
      if (u.includes("period=week")) {
        return Promise.resolve({ ok: true, status: 200, json: async () => weekModalPage1 });
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => modalPage1 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderPanel();
    await screen.findByText("Aaa");
    await user.click(screen.getByRole("button", { name: /view all/i }));
    const dialog = screen.getByRole("dialog");
    await within(dialog).findByText("Aaa");

    // Navigate to page 2
    await user.click(within(dialog).getByLabelText("Next page"));
    await within(dialog).findByText("Ddd");

    // Switch period to weekly
    const weeklyRadio = within(dialog).getAllByRole("radio", { name: /weekly/i })[0];
    await user.click(weeklyRadio);

    // Verify weekly page=1 was requested
    await waitFor(() => {
      const calls = fetchMock.mock.calls.map(([u]) => String(u));
      const weeklyPage1 = calls.some((u) => u.includes("period=week") && u.includes("page=1"));
      expect(weeklyPage1).toBe(true);
    });

    // Verify weekly page=2 was NOT requested
    const weeklyPage2Calls = fetchMock.mock.calls
      .map(([u]) => String(u))
      .filter((u) => u.includes("period=week") && u.includes("page=2"));
    expect(weeklyPage2Calls.length).toBe(0);
  });
});
