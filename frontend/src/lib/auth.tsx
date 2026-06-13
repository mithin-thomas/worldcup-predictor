import { useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getMe, loginWithGoogle, logout } from "./api";

export function useMe() {
  return useQuery({ queryKey: ["me"], queryFn: getMe, retry: false });
}

// GoogleSignInButton renders the GIS button and calls the backend with the ID token.
export function GoogleSignInButton() {
  const ref = useRef<HTMLDivElement>(null);
  const qc = useQueryClient();
  const login = useMutation({
    mutationFn: loginWithGoogle,
    onSuccess: (me) => qc.setQueryData(["me"], me),
  });

  useEffect(() => {
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string;
    // @ts-expect-error google is injected by the GIS script in index.html
    const google = window.google;
    if (!google || !ref.current) return;
    google.accounts.id.initialize({
      client_id: clientId,
      callback: (resp: { credential: string }) => login.mutate(resp.credential),
    });
    google.accounts.id.renderButton(ref.current, { theme: "filled_black", size: "large" });
  }, [login]);

  return (
    <div>
      <div ref={ref} />
      {login.isError && <p className="muted">{(login.error as Error).message}</p>}
    </div>
  );
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: logout,
    onSuccess: () => qc.setQueryData(["me"], null),
  });
}
