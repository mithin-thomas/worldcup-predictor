const BASE = import.meta.env.VITE_API_BASE_URL ?? "/api";

export type TeamDTO = {
  id: number;
  name: string;
  code: string;
  logo_url: string;
};

export type MatchDTO = {
  id: number;
  stage: "group" | "knockout";
  round: string;
  kickoff_utc: string;
  kickoff_ist: string;
  status: "scheduled" | "live" | "final";
  locked: boolean;
  home: TeamDTO;
  away: TeamDTO;
  home_score: number | null;
  away_score: number | null;
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
