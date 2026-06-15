import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

const BASE = import.meta.env.VITE_API_BASE_URL ?? "/api";

export type TeamDTO = { id: number; name: string; code: string };
export type VenueDTO = { name: string; city: string; country: string };

export type PredictionDTO = {
  home_score: number;
  away_score: number;
  penalty_winner_team_id: number | null;
  // points/penalty_bonus are null until the match is scored FINAL
  points: number | null;
  penalty_bonus: number | null;
};

export type PredictionInput = {
  home_score: number;
  away_score: number;
  penalty_winner_team_id?: number | null;
};

// PredictionLockedError signals a server 409 — the match locked at kickoff.
export class PredictionLockedError extends Error {
  constructor() {
    super("match is locked");
    this.name = "PredictionLockedError";
  }
}

export type MatchDTO = {
  id: number;
  match_number: number;
  stage: "group" | "knockout";
  round: string;
  group: string;
  label: string;
  kickoff_utc: string;
  kickoff_ist: string;
  status: "scheduled" | "live" | "final";
  locked: boolean;
  home: TeamDTO | null;
  away: TeamDTO | null;
  venue: VenueDTO | null;
  home_score: number | null;
  away_score: number | null;
  prediction: PredictionDTO | null;
};

export type DayDTO = {
  date: string; // IST calendar date e.g. "2026-06-12"
  matches: MatchDTO[];
};

export type MatchesResponse = {
  days: DayDTO[];
};

export async function getMatches(): Promise<MatchesResponse> {
  const res = await fetch(`${BASE}/matches`, { credentials: "include" });
  if (!res.ok) throw new Error(`Failed to load matches: ${res.status}`);
  return res.json() as Promise<MatchesResponse>;
}

export async function putPrediction(matchId: number, input: PredictionInput): Promise<PredictionDTO> {
  const res = await fetch(`${BASE}/matches/${matchId}/prediction`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (res.status === 409) throw new PredictionLockedError();
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `save failed: ${res.status}`);
  }
  return res.json() as Promise<PredictionDTO>;
}

// usePutPrediction saves a prediction and refreshes the matches cache on success.
export function usePutPrediction(matchId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: PredictionInput) => putPrediction(matchId, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["matches"] });
    },
  });
}

// ── Others' predictions (revealed after a match locks at kickoff — spec §4) ──

export type MatchPredictionDTO = {
  user_id: number;
  name: string;
  avatar_url: string;
  home_score: number;
  away_score: number;
  penalty_winner_team_id: number | null;
  // null until the match is scored FINAL
  points: number | null;
  penalty_bonus: number | null;
  is_me: boolean;
};

// getMatchPredictions returns every player's pick for a match. The server only
// serves this once the match has locked (403 before kickoff).
export async function getMatchPredictions(matchId: number): Promise<MatchPredictionDTO[]> {
  const res = await fetch(`${BASE}/matches/${matchId}/predictions`, { credentials: "include" });
  if (!res.ok) throw new Error(`Failed to load predictions: ${res.status}`);
  return res.json() as Promise<MatchPredictionDTO[]>;
}

// useMatchPredictions fetches others' picks for a locked match. Pass enabled=false
// (e.g. when the match isn't locked yet) to avoid a guaranteed-403 request.
export function useMatchPredictions(matchId: number, enabled: boolean) {
  return useQuery({
    queryKey: ["match-predictions", matchId],
    queryFn: () => getMatchPredictions(matchId),
    enabled,
  });
}
