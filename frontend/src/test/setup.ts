import "@testing-library/jest-dom/vitest";

// jsdom does not implement matchMedia; components that read prefers-reduced-motion
// (e.g. Countdown) rely on it. Provide a no-match stub for the test environment.
if (typeof window !== "undefined" && !window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList;
}
