import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

const BASE = import.meta.env.VITE_API_BASE_URL ?? "/api";

export type BonusPick = {
  category: string;
  ref_type: "team" | "player";
  ref_id: number;
  points?: number;
};

export type BonusResponse = {
  lock_at: string;
  locked: boolean;
  picks: BonusPick[];
};

export type TeamOption = { id: number; name: string; code: string };
export type PlayerOption = {
  id: number;
  name: string;
  team_code: string;
  position: string;
};

export async function getBonus(): Promise<BonusResponse> {
  const res = await fetch(`${BASE}/bonus`, { credentials: "include" });
  if (!res.ok) throw new Error(`bonus failed: ${res.status}`);
  return res.json();
}

export function useBonus() {
  return useQuery({ queryKey: ["bonus"], queryFn: getBonus });
}

export async function getTeams(): Promise<TeamOption[]> {
  const res = await fetch(`${BASE}/teams`, { credentials: "include" });
  if (!res.ok) throw new Error(`teams failed: ${res.status}`);
  return res.json();
}

export function useTeams() {
  return useQuery({ queryKey: ["teams"], queryFn: getTeams, staleTime: Infinity });
}

export async function searchPlayers(q: string): Promise<PlayerOption[]> {
  const res = await fetch(`${BASE}/players?q=${encodeURIComponent(q)}`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error(`players failed: ${res.status}`);
  return res.json();
}

export function usePlayerSearch(q: string) {
  return useQuery({
    queryKey: ["players", q],
    queryFn: () => searchPlayers(q),
    enabled: q.length >= 2,
  });
}

export type SavePick = { category: string; ref_id: number };

export async function saveBonus(picks: SavePick[]): Promise<BonusResponse> {
  const res = await fetch(`${BASE}/bonus`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ picks }),
  });
  if (!res.ok) throw new Error(`save bonus failed: ${res.status}`);
  return res.json();
}

export function useSaveBonus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: saveBonus,
    onSuccess: (data) => qc.setQueryData(["bonus"], data),
  });
}
