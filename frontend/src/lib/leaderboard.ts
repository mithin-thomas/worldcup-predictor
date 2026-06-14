import { useQuery } from "@tanstack/react-query";

const BASE = import.meta.env.VITE_API_BASE_URL ?? "/api";

export type LeaderboardRow = {
  rank: number;
  user_id: number;
  name: string;
  avatar_url: string;
  points: number;
  exact: number;
  correct: number;
  is_winner: boolean;
  is_me: boolean;
};

export type LeaderboardResponse = {
  period: "week" | "overall";
  week?: string;
  page: number;
  page_size: number;
  total: number;
  rows: LeaderboardRow[];
  me: { rank: number; points: number } | null;
};

export async function getLeaderboard(
  period: "week" | "overall",
  page = 1,
): Promise<LeaderboardResponse> {
  const res = await fetch(`${BASE}/leaderboard?period=${period}&page=${page}`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error(`leaderboard failed: ${res.status}`);
  return res.json() as Promise<LeaderboardResponse>;
}

export function useLeaderboard(period: "week" | "overall", page = 1) {
  return useQuery({
    queryKey: ["leaderboard", period, page],
    queryFn: () => getLeaderboard(period, page),
  });
}
