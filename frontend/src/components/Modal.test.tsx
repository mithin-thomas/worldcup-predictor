import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Modal } from "./Modal";

afterEach(() => {
  document.body.style.overflow = "";
});

describe("Modal", () => {
  it("portals to the body, locks scroll, and closes from the backdrop", () => {
    const onClose = vi.fn();
    render(
      <Modal title="Edit match" onClose={onClose}>
        <input aria-label="Example field" />
      </Modal>,
    );

    const dialog = screen.getByRole("dialog", { name: "Edit match" });
    expect(dialog.parentElement?.parentElement).toBe(document.body);
    expect(document.body.style.overflow).toBe("hidden");

    fireEvent.mouseDown(dialog.parentElement as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes with Escape and exposes a close button", () => {
    const onClose = vi.fn();
    render(<Modal title="New match" onClose={onClose}>Form</Modal>);

    expect(screen.getByRole("button", { name: "Close modal" })).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
