const BASE = import.meta.env.VITE_API_BASE_URL ?? "/api";

export type Me = {
  id: number;
  email: string;
  name: string;
  avatar_url: string;
  role: "user" | "admin";
};

export async function getMe(): Promise<Me | null> {
  const res = await fetch(`${BASE}/me`, { credentials: "include" });
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(`/me failed: ${res.status}`);
  return res.json();
}

export async function loginWithGoogle(idToken: string): Promise<Me> {
  const res = await fetch(`${BASE}/auth/google`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id_token: idToken }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `login failed: ${res.status}`);
  }
  return res.json();
}

export async function logout(): Promise<void> {
  await fetch(`${BASE}/auth/logout`, { method: "POST", credentials: "include" });
}
