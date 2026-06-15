/**
 * Tests for ist.ts helpers.
 *
 * Key coverage for currentISTMonday():
 * - Returns the correct IST Monday regardless of host timezone.
 * - Near a day boundary: a moment that is Monday in IST but Sunday in UTC
 *   must still return the IST Monday (not the UTC Sunday's week).
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { currentISTMonday, weekRange, istRelLabel } from "./ist";

afterEach(() => {
  vi.useRealTimers();
});

describe("currentISTMonday", () => {
  /**
   * Pin system time to 2026-06-15 (Monday) at 09:00 IST
   * = 2026-06-15T03:30:00Z (UTC).
   * Both UTC and IST agree this is a Monday; the returned string must be "2026-06-15".
   */
  it("returns the IST Monday when the host day also happens to be Monday (UTC)", () => {
    vi.useFakeTimers();
    // 2026-06-15T03:30:00Z  →  2026-06-15T09:00:00+05:30  (Monday in IST)
    vi.setSystemTime(new Date("2026-06-15T03:30:00Z"));
    expect(currentISTMonday()).toBe("2026-06-15");
  });

  /**
   * 2026-06-17 (Wednesday) at 14:00 IST = 2026-06-17T08:30:00Z.
   * Monday of that IST week is 2026-06-15.
   */
  it("returns the correct Monday from mid-week (Wednesday IST)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-17T08:30:00Z")); // Wed 14:00 IST
    expect(currentISTMonday()).toBe("2026-06-15");
  });

  /**
   * 2026-06-21 (Sunday) at 23:59 IST = 2026-06-21T18:29:00Z.
   * Monday of that IST week is 2026-06-15.
   */
  it("returns the Monday at the end of the IST week (Sunday IST)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-21T18:29:00Z")); // Sun 23:59 IST
    expect(currentISTMonday()).toBe("2026-06-15");
  });

  /**
   * CRITICAL TZ boundary test.
   *
   * 2026-06-15T00:00:00+05:30  =  2026-06-14T18:30:00Z
   *
   * In IST  → Monday  00:00 → week starting 2026-06-15
   * In UTC  → Sunday  18:30 → UTC-based getDay() would say "Sunday" and
   *           produce the *previous* Monday (2026-06-08) — the bug this fixes.
   *
   * The correct answer is "2026-06-15".
   */
  it("returns the IST Monday even when the same UTC instant is Sunday in UTC (day-boundary crossing)", () => {
    vi.useFakeTimers();
    // Exactly midnight IST Monday 2026-06-15 = 18:30 Sunday in UTC
    vi.setSystemTime(new Date("2026-06-14T18:30:00Z"));
    expect(currentISTMonday()).toBe("2026-06-15");
  });

  /**
   * One minute BEFORE IST midnight: still the previous week.
   * 2026-06-14T23:59:00+05:30  =  2026-06-14T18:29:00Z  (Sunday IST)
   * → Monday is 2026-06-08.
   */
  it("returns the previous week's Monday when 1 minute before IST midnight on Sunday", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-14T18:29:00Z")); // 23:59 IST Sunday
    expect(currentISTMonday()).toBe("2026-06-08");
  });
});

describe("weekRange", () => {
  it("same month range", () => {
    expect(weekRange("2026-06-08")).toBe("8–14 Jun 2026");
  });

  it("cross-month range (Jun–Jul)", () => {
    expect(weekRange("2026-06-29")).toBe("29 Jun – 5 Jul 2026");
  });
});

describe("istRelLabel", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns Today for current IST date", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-15T03:30:00Z")); // 09:00 IST Mon 2026-06-15
    expect(istRelLabel("2026-06-15")).toBe("Today");
  });

  it("returns Tomorrow for tomorrow's IST date", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-15T03:30:00Z"));
    expect(istRelLabel("2026-06-16")).toBe("Tomorrow");
  });

  it("returns Yesterday for yesterday's IST date", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-15T03:30:00Z"));
    expect(istRelLabel("2026-06-14")).toBe("Yesterday");
  });

  it("returns null for a date further away", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-15T03:30:00Z"));
    expect(istRelLabel("2026-06-20")).toBeNull();
  });
});
