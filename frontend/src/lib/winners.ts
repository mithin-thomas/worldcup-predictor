import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

const BASE = import.meta.env.VITE_API_BASE_URL ?? "/api";

export type Winner = {
  user_id: number;
  name: string;
  avatar_url: string;
  points: number;
  prize_paid: boolean;
};

export type WinnerWeek = {
  week_start: string; // YYYY-MM-DD (IST calendar Monday)
  winners: Winner[];
};

export type WinnersResponse = { weeks: WinnerWeek[] };

export async function getWinners(): Promise<WinnersResponse> {
  const res = await fetch(`${BASE}/winners`, { credentials: "include" });
  if (!res.ok) throw new Error(`winners failed: ${res.status}`);
  return res.json() as Promise<WinnersResponse>;
}

export function useWinners() {
  return useQuery({ queryKey: ["winners"], queryFn: getWinners });
}

export type MarkPaidInput = {
  week_start: string;
  user_id: number;
  paid: boolean;
};

export async function markWinnerPaid(input: MarkPaidInput): Promise<void> {
  const res = await fetch(`${BASE}/admin/winners/paid`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`mark paid failed: ${res.status}`);
}

export function useMarkWinnerPaid() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: markWinnerPaid,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["winners"] }),
  });
}
