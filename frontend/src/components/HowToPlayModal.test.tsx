import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HowToPlayModal } from "./HowToPlayModal";

afterEach(() => vi.restoreAllMocks());

describe("HowToPlayModal", () => {
  // ── Rendering ────────────────────────────────────────────────────────────

  it("renders the dialog with role=dialog and aria-modal", () => {
    render(<HowToPlayModal onClose={vi.fn()} />);
    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAttribute("aria-modal", "true");
  });

  it("has an accessible title 'How to play'", () => {
    render(<HowToPlayModal onClose={vi.fn()} />);
    expect(
      screen.getByRole("heading", { name: /how to play/i })
    ).toBeInTheDocument();
  });

  it("renders the close button with accessible label", () => {
    render(<HowToPlayModal onClose={vi.fn()} />);
    expect(screen.getByRole("button", { name: /close/i })).toBeInTheDocument();
  });

  // ── Rules content ────────────────────────────────────────────────────────

  it("shows the exact-score rule with 5 points", () => {
    render(<HowToPlayModal onClose={vi.fn()} />);
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/exact score/i)).toBeInTheDocument();
    // The numeric "5" is present in the dialog
    const fives = within(dialog).getAllByText("5");
    expect(fives.length).toBeGreaterThanOrEqual(1);
  });

  it("shows Tournament Bonus section", () => {
    render(<HowToPlayModal onClose={vi.fn()} />);
    expect(screen.getByText(/tournament bonus/i)).toBeInTheDocument();
  });

  it("shows World Cup Winner with 30 points", () => {
    render(<HowToPlayModal onClose={vi.fn()} />);
    expect(screen.getByText(/world cup winner/i)).toBeInTheDocument();
    // "30" should appear in the bonus table
    expect(screen.getByText("30")).toBeInTheDocument();
  });

  it("shows the ₹500 weekly prize", () => {
    render(<HowToPlayModal onClose={vi.fn()} />);
    expect(screen.getByText(/₹500/)).toBeInTheDocument();
  });

  it("shows the kickoff lock rule", () => {
    render(<HowToPlayModal onClose={vi.fn()} />);
    const matches = screen.getAllByText(/kickoff/i);
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it("shows the good luck footer line", () => {
    render(<HowToPlayModal onClose={vi.fn()} />);
    expect(screen.getByText(/good luck/i)).toBeInTheDocument();
  });

  // ── Close interactions ────────────────────────────────────────────────────

  it("calls onClose when the close button is clicked", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<HowToPlayModal onClose={onClose} />);
    await user.click(screen.getByRole("button", { name: /close/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when Escape is pressed", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<HowToPlayModal onClose={onClose} />);
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when the backdrop (overlay) is clicked", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const { container } = render(<HowToPlayModal onClose={onClose} />);
    // The overlay element is the outermost div with role=dialog
    const overlay = container.firstChild as HTMLElement;
    // Click directly on the overlay (not on the inner dialog card)
    await user.click(overlay);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // ── Focus management ─────────────────────────────────────────────────────

  it("auto-focuses the close button on mount", () => {
    render(<HowToPlayModal onClose={vi.fn()} />);
    expect(screen.getByRole("button", { name: /close/i })).toHaveFocus();
  });

  it("has aria-labelledby pointing to the title element", () => {
    render(<HowToPlayModal onClose={vi.fn()} />);
    const dialog = screen.getByRole("dialog");
    const labelledBy = dialog.getAttribute("aria-labelledby");
    expect(labelledBy).toBeTruthy();
    const titleEl = document.getElementById(labelledBy!);
    expect(titleEl).toBeInTheDocument();
    expect(titleEl?.textContent).toMatch(/how to play/i);
  });
});
