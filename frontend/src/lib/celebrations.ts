import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

const BASE = import.meta.env.VITE_API_BASE_URL ?? "/api";

export type Celebration = {
  match_id: number;
  team_code: string;
  team_score: number;
  opponent_code: string;
  opponent_score: number;
  kickoff_utc: string;
};

export async function getCelebrations(): Promise<Celebration[]> {
  const res = await fetch(`${BASE}/celebrations`, { credentials: "include" });
  if (!res.ok) throw new Error(`celebrations failed: ${res.status}`);
  const body = (await res.json()) as { celebrations: Celebration[] };
  return body.celebrations ?? [];
}

export async function markCelebrationsSeen(matchIds: number[]): Promise<void> {
  const res = await fetch(`${BASE}/celebrations/seen`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ match_ids: matchIds }),
  });
  if (!res.ok) throw new Error(`mark seen failed: ${res.status}`);
}

export function useCelebrations(enabled: boolean) {
  return useQuery({ queryKey: ["celebrations"], queryFn: getCelebrations, enabled });
}

export function useMarkCelebrationsSeen() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: markCelebrationsSeen,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["celebrations"] });
    },
  });
}
