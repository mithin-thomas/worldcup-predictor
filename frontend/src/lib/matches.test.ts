import { describe, it, expect, vi, afterEach } from "vitest";
import { putPrediction, PredictionLockedError } from "./matches";

afterEach(() => vi.restoreAllMocks());

describe("putPrediction", () => {
  it("PUTs to the prediction endpoint and returns the stored pick", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ home_score: 2, away_score: 1, penalty_winner_team_id: null }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await putPrediction(7, { home_score: 2, away_score: 1 });

    expect(result).toEqual({ home_score: 2, away_score: 1, penalty_winner_team_id: null });
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toContain("/matches/7/prediction");
    expect(opts.method).toBe("PUT");
    expect(opts.credentials).toBe("include");
    expect(JSON.parse(opts.body)).toEqual({ home_score: 2, away_score: 1 });
  });

  it("throws PredictionLockedError on a 409", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 409, json: async () => ({ error: "match is locked" }) }));
    await expect(putPrediction(7, { home_score: 1, away_score: 1 })).rejects.toBeInstanceOf(PredictionLockedError);
  });
});
