import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

const BASE = import.meta.env.VITE_API_BASE_URL ?? "/api";

// ── Types ─────────────────────────────────────────────────────────────────────

export type AdminMatch = {
  id: number;
  match_number: number;
  stage: "group" | "knockout";
  round: string;
  home_team_id: number | null;
  home_team: string;
  home_code: string;
  away_team_id: number | null;
  away_team: string;
  away_code: string;
  kickoff_utc: string; // ISO-8601 UTC
  status: string;
  home_score: number | null;
  away_score: number | null;
  went_to_penalties: boolean;
  penalty_winner_team_id: number | null;
  manual_override: boolean;
};

export type AdminUser = {
  id: number;
  email: string;
  name: string;
  avatar_url: string;
  role: "admin" | "user";
};

export type CreateMatchInput = {
  home_team_id: number;
  away_team_id: number;
  kickoff_utc: string; // RFC3339 UTC
  stage: "group" | "knockout";
  round: string;
};

export type UpdateMatchInput = CreateMatchInput;

export type SetMatchResultInput = {
  id: number;
  home_score: number;
  away_score: number;
  went_to_penalties: boolean;
  penalty_winner_team_id?: number | null;
};

export type SetUserRoleInput = {
  id: number;
  role: "admin" | "user";
};

// ── Helpers ───────────────────────────────────────────────────────────────────

async function apiFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: "include",
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  if (!res.ok) {
    let msg = `${res.status}`;
    try {
      const json = (await res.json()) as { error?: string };
      if (json.error) msg = json.error;
    } catch {
      // ignore parse failure
    }
    throw new Error(msg);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

// ── Queries ───────────────────────────────────────────────────────────────────

export function useAdminMatches() {
  return useQuery<AdminMatch[]>({
    queryKey: ["admin", "matches"],
    queryFn: () => apiFetch<AdminMatch[]>("/admin/matches"),
  });
}

export function useAdminUsers() {
  return useQuery<AdminUser[]>({
    queryKey: ["admin", "users"],
    queryFn: () => apiFetch<AdminUser[]>("/admin/users"),
  });
}

// ── Mutations ─────────────────────────────────────────────────────────────────

export function useCreateMatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateMatchInput) =>
      apiFetch<{ id: number }>("/admin/matches", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "matches"] }),
  });
}

export function useUpdateMatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: UpdateMatchInput & { id: number }) =>
      apiFetch<{ id: number }>(`/admin/matches/${id}`, {
        method: "PUT",
        body: JSON.stringify(body),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "matches"] }),
  });
}

export function useDeleteMatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      apiFetch<void>(`/admin/matches/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "matches"] }),
  });
}

export function useSetMatchResult() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: SetMatchResultInput) =>
      apiFetch<{ id: number; status: string }>(`/admin/matches/${id}/result`, {
        method: "PUT",
        body: JSON.stringify(body),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "matches"] }),
  });
}

export function useSetUserRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, role }: SetUserRoleInput) =>
      apiFetch<{ id: number; role: string }>(`/admin/users/${id}/role`, {
        method: "POST",
        body: JSON.stringify({ role }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "users"] }),
  });
}
