import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { useLogout, useMe } from "./lib/auth";

vi.mock("./lib/auth", () => ({
  GoogleSignInButton: () => <button type="button">Sign in with Google</button>,
  useLogout: vi.fn(),
  useMe: vi.fn(),
}));

vi.mock("./routes/Home", () => ({
  Home: ({ mobileView }: { mobileView?: "fixtures" | "ranks" }) => (
    <main data-testid="home" data-mobile-view={mobileView ?? "desktop"}>
      Home {mobileView ?? "desktop"}
    </main>
  ),
}));

vi.mock("./routes/Admin", () => ({
  Admin: () => <main data-testid="admin">Admin screen</main>,
}));

vi.mock("./components/HowToPlayModal", () => ({
  HowToPlayModal: ({ onClose }: { onClose: () => void }) => (
    <div role="dialog" aria-label="How to play">
      <button type="button" onClick={onClose}>
        Close help
      </button>
    </div>
  ),
}));

const logoutMutate = vi.fn();

function setPhoneViewport(matches: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query === "(max-width: 760px)" ? matches : false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

function mockSession(role: "admin" | "user" = "user") {
  vi.mocked(useMe).mockReturnValue({
    data: {
      id: 7,
      email: "priya@sayonetech.com",
      name: "Priya",
      avatar_url: "",
      role,
    },
    isLoading: false,
  } as unknown as ReturnType<typeof useMe>);

  vi.mocked(useLogout).mockReturnValue({
    mutate: logoutMutate,
    isPending: false,
  } as unknown as ReturnType<typeof useLogout>);
}

describe("App shell", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setPhoneViewport(false);
    mockSession();
  });

  it("routes the phone tab bar between prediction fixtures and standings", async () => {
    const user = userEvent.setup();
    setPhoneViewport(true);
    mockSession("user");

    render(<App />);

    const home = screen.getByTestId("home");
    expect(home).toHaveAttribute("data-mobile-view", "fixtures");

    const mobileNav = screen.getByRole("navigation", { name: "Primary mobile navigation" });
    expect(within(mobileNav).queryByRole("button", { name: "Admin" })).not.toBeInTheDocument();

    await user.click(within(mobileNav).getByRole("button", { name: "Standings" }));
    expect(home).toHaveAttribute("data-mobile-view", "ranks");

    await user.click(within(mobileNav).getByRole("button", { name: "Predict" }));
    expect(home).toHaveAttribute("data-mobile-view", "fixtures");
  });

  it("exposes the phone admin tab only for admins", async () => {
    const user = userEvent.setup();
    setPhoneViewport(true);
    mockSession("admin");

    render(<App />);

    const mobileNav = screen.getByRole("navigation", { name: "Primary mobile navigation" });
    await user.click(within(mobileNav).getByRole("button", { name: "Admin" }));

    expect(screen.getByTestId("admin")).toBeInTheDocument();
    expect(screen.queryByTestId("home")).not.toBeInTheDocument();
  });

  it("opens profile actions from the topbar menu", async () => {
    const user = userEvent.setup();

    render(<App />);

    await user.click(screen.getByRole("button", { name: "Profile menu for Priya" }));
    expect(screen.getByText("priya@sayonetech.com")).toBeInTheDocument();

    await user.click(screen.getByRole("menuitem", { name: "How to play" }));
    expect(screen.getByRole("dialog", { name: "How to play" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Profile menu for Priya" }));
    await user.click(screen.getByRole("menuitem", { name: "Log out" }));
    // Destructive action: must confirm before it fires.
    expect(logoutMutate).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Log out" }));
    expect(logoutMutate).toHaveBeenCalledTimes(1);
  });
});
