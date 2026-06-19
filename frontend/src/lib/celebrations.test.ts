import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getCelebrations, markCelebrationsSeen } from "./celebrations";

describe("celebrations api", () => {
  beforeEach(() => { vi.restoreAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it("getCelebrations returns the celebrations array", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ celebrations: [{ match_id: 12, team_code: "BRA", team_score: 3, opponent_code: "JOR", opponent_score: 1, kickoff_utc: "2026-06-19T18:00:00Z" }] }),
    }));
    const out = await getCelebrations();
    expect(out).toHaveLength(1);
    expect(out[0].match_id).toBe(12);
    expect(out[0].team_code).toBe("BRA");
  });

  it("markCelebrationsSeen POSTs match_ids", async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ seen: 2 }) });
    vi.stubGlobal("fetch", f);
    await markCelebrationsSeen([12, 9]);
    expect(f).toHaveBeenCalledOnce();
    const [, init] = f.mock.calls[0];
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ match_ids: [12, 9] });
    expect(init.credentials).toBe("include");
  });
});
