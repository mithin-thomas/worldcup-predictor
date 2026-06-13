import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getMe, loginWithGoogle, logout } from "./api";

export function useMe() {
  return useQuery({ queryKey: ["me"], queryFn: getMe, retry: false });
}

type GisStatus = "loading" | "ready" | "unavailable";

// GoogleSignInButton renders the Google Identity Services button and exchanges
// the returned credential for a session. The GIS script loads async, so we poll
// for `window.google` rather than reading it once on mount; if it never arrives
// (offline, or this origin isn't an authorized JS origin) we show a clear hint
// instead of a blank space.
export function GoogleSignInButton() {
  const ref = useRef<HTMLDivElement>(null);
  const qc = useQueryClient();
  const [status, setStatus] = useState<GisStatus>("loading");

  const login = useMutation({
    mutationFn: loginWithGoogle,
    onSuccess: (me) => qc.setQueryData(["me"], me),
  });

  useEffect(() => {
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
    let tries = 0;
    const timer = window.setInterval(() => {
      // @ts-expect-error google is injected by the GIS script in index.html
      const google = window.google;
      if (google?.accounts?.id && ref.current) {
        window.clearInterval(timer);
        google.accounts.id.initialize({
          client_id: clientId,
          callback: (resp: { credential: string }) => login.mutate(resp.credential),
        });
        google.accounts.id.renderButton(ref.current, {
          theme: "filled_black",
          size: "large",
          shape: "pill",
          text: "signin_with",
          width: 280,
        });
        setStatus("ready");
      } else if (++tries >= 25) {
        // ~5s with no GIS script available
        window.clearInterval(timer);
        setStatus("unavailable");
      }
    }, 200);
    return () => window.clearInterval(timer);
    // login is a stable TanStack mutation handle; run this once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="auth__signin">
      <div ref={ref} className="auth__gis" data-status={status} aria-live="polite" />

      {status === "loading" && <div className="auth__skeleton" aria-hidden="true" />}

      {status === "unavailable" && (
        <p className="auth__hint" role="status">
          Couldn’t load Google sign-in. Check your connection, and that this origin is an authorized
          JavaScript origin for the OAuth client.
        </p>
      )}

      {login.isPending && (
        <p className="auth__hint" role="status">
          Signing you in…
        </p>
      )}

      {login.isError && (
        <p className="auth__error" role="alert">
          {(login.error as Error).message}
        </p>
      )}
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
