import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LeaderboardModal } from "./LeaderboardModal";

const overall = {
  period: "overall",
  page: 1,
  page_size: 20,
  total: 2,
  rows: [
    { rank: 1, user_id: 5, name: "Aaa", avatar_url: "", points: 18, exact: 3, correct: 1, is_winner: false, is_me: false },
    { rank: 2, user_id: 1, name: "Me", avatar_url: "", points: 12, exact: 1, correct: 3, is_winner: false, is_me: true },
  ],
  me: { rank: 2, points: 12 },
};

function renderModal() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <LeaderboardModal initialPeriod="overall" onClose={() => {}} />
    </QueryClientProvider>,
  );
}

afterEach(() => vi.restoreAllMocks());

describe("LeaderboardModal — Exact filter", () => {
  it("hides exact picks until the Exact toggle is on, then shows each player's count", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => overall }));
    const user = userEvent.setup();
    renderModal();

    // Rows render (points are always shown).
    await waitFor(() => expect(screen.getByLabelText("18 points")).toBeInTheDocument());

    // Exact counts are hidden by default.
    expect(screen.queryByLabelText("3 exact picks")).not.toBeInTheDocument();

    // Turn the filter on.
    const toggle = screen.getByRole("button", { name: /exact/i });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    await user.click(toggle);

    // Each player's exact-pick count is now visible.
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("3 exact picks")).toBeInTheDocument();
    expect(screen.getByLabelText("1 exact picks")).toBeInTheDocument();
    // Points remain.
    expect(screen.getByLabelText("18 points")).toBeInTheDocument();
  });
});
