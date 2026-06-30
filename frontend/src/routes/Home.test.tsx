import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Home } from "./Home";

// Stub the data panels so this test targets only the banner wiring.
vi.mock("../components/BonusPanel", () => ({ BonusPanel: () => null }));
vi.mock("../components/MatchesColumn", () => ({ MatchesColumn: () => null }));
vi.mock("../components/StandingCard", () => ({ StandingCard: () => null }));
vi.mock("../components/LeaderboardPanel", () => ({ LeaderboardPanel: () => null }));
vi.mock("../components/HallOfFame", () => ({ HallOfFame: () => null }));

function wrap(ui: React.ReactNode) {
  return <QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>;
}

describe("Home promo banners", () => {
  it("invokes onOpenGame when the GOAT card is clicked", async () => {
    const onOpenGame = vi.fn();
    render(wrap(<Home onOpenGame={onOpenGame} />));
    await userEvent.click(screen.getByRole("button", { name: /chased by the goat/i }));
    expect(onOpenGame).toHaveBeenCalledTimes(1);
  });

  it("keeps Penalty Shootout an external link", () => {
    render(wrap(<Home onOpenGame={() => {}} />));
    const link = screen.getByRole("link", { name: /penalty shootout/i });
    expect(link).toHaveAttribute("target", "_blank");
  });
});
