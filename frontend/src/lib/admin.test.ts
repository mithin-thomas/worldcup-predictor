import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { useSaveSettings } from "./admin";
import type { AdminSettings } from "./admin";

afterEach(() => vi.restoreAllMocks());

describe("useSaveSettings — invalidation", () => {
  it("invalidates ['admin','settings'] AND ['bonus'] after a successful save", async () => {
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });

    // Seed both caches with placeholder data so invalidateQueries has something to act on
    qc.setQueryData(["admin", "settings"], {
      results_cron: "0 3 * * *",
      weekly_cron: "30 13 * * 1",
      bonus_lock_at: "2026-06-28T23:59:00+05:30",
    });
    qc.setQueryData(["bonus"], []);

    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");

    const savedSettings: AdminSettings = {
      results_cron: "0 4 * * *",
      weekly_cron: "30 13 * * 1",
      bonus_lock_at: "2026-06-29T00:00:00+05:30",
    };

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => savedSettings,
      }),
    );

    const wrapper = ({ children }: { children: React.ReactNode }) =>
      createElement(QueryClientProvider, { client: qc }, children);

    const { result } = renderHook(() => useSaveSettings(), { wrapper });

    act(() => {
      result.current.mutate({ results_cron: "0 4 * * *" });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const invalidatedKeys = invalidateSpy.mock.calls.map(
      (call) => (call[0] as { queryKey?: unknown[] }).queryKey,
    );

    expect(invalidatedKeys).toContainEqual(["admin", "settings"]);
    expect(invalidatedKeys).toContainEqual(["bonus"]);
  });
});
