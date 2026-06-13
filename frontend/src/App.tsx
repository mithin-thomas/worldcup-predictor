import { useMe, GoogleSignInButton, useLogout } from "./lib/auth";
import { Fixtures } from "./routes/Fixtures";

export default function App() {
  const { data: me, isLoading } = useMe();
  const logout = useLogout();

  if (isLoading) return <div className="card">Loading…</div>;

  if (!me) {
    return (
      <div className="card">
        <h1>SayScore</h1>
        <p className="muted">Sign in with your sayonetech.com Google account.</p>
        <GoogleSignInButton />
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header className="topbar" role="banner">
        <span className="topbar__brand" aria-label="SayScore">SayScore</span>
        <div className="topbar__user">
          <span className="topbar__name" aria-label={`Signed in as ${me.name || me.email}`}>
            {me.name || me.email}
          </span>
          <button
            className="topbar__logout btn-ghost"
            onClick={() => logout.mutate()}
            disabled={logout.isPending}
            aria-label="Log out"
          >
            {logout.isPending ? "…" : "Log out"}
          </button>
        </div>
      </header>

      <Fixtures />
    </div>
  );
}
