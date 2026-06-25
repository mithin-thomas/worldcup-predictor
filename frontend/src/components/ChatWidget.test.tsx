import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { ChatWidget } from "./ChatWidget";
import * as chatLib from "../lib/chat";

beforeEach(() => sessionStorage.clear());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function openPanel() {
  fireEvent.click(screen.getByLabelText(/open chat assistant/i));
}

describe("ChatWidget", () => {
  it("launcher opens and closes the panel", () => {
    render(<ChatWidget />);
    expect(screen.queryByPlaceholderText(/message/i)).toBeNull();
    openPanel();
    expect(screen.getByPlaceholderText(/message/i)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/close chat/i));
    expect(screen.queryByPlaceholderText(/message/i)).toBeNull();
  });

  it("sends a message and streams the assistant reply", async () => {
    vi.spyOn(chatLib, "streamChat").mockImplementation(async (_msgs, onToken) => {
      onToken("Hi ");
      onToken("there");
    });
    render(<ChatWidget />);
    openPanel();
    fireEvent.change(screen.getByPlaceholderText(/message/i), { target: { value: "hello" } });
    fireEvent.click(screen.getByLabelText(/send message/i));
    expect(await screen.findByText("hello")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Hi there")).toBeInTheDocument());
  });

  it("persists history in sessionStorage across remount", async () => {
    vi.spyOn(chatLib, "streamChat").mockImplementation(async (_m, onToken) => onToken("yo"));
    const { unmount } = render(<ChatWidget />);
    openPanel();
    fireEvent.change(screen.getByPlaceholderText(/message/i), { target: { value: "ping" } });
    fireEvent.click(screen.getByLabelText(/send message/i));
    await screen.findByText("yo");
    unmount();
    render(<ChatWidget />);
    openPanel();
    expect(screen.getByText("ping")).toBeInTheDocument();
    expect(screen.getByText("yo")).toBeInTheDocument();
  });

  it("shows an unavailable notice on 503", async () => {
    vi.spyOn(chatLib, "streamChat").mockRejectedValue(new chatLib.ChatUnavailableError());
    render(<ChatWidget />);
    openPanel();
    fireEvent.change(screen.getByPlaceholderText(/message/i), { target: { value: "hi" } });
    fireEvent.click(screen.getByLabelText(/send message/i));
    expect(await screen.findByText(/assistant is unavailable/i)).toBeInTheDocument();
  });
});
