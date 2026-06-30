import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("./GoatGame", () => ({ GoatGame: () => <div data-testid="goat-host" /> }));
import { GameOverlay } from "./GameOverlay";

describe("GameOverlay", () => {
  it("renders the game host and closes on the ✕ button", async () => {
    const onClose = vi.fn();
    render(<GameOverlay onClose={onClose} />);
    expect(screen.getByTestId("goat-host")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /close game/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
