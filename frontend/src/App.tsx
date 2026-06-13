import { useMe, GoogleSignInButton, useLogout } from "./lib/auth";
import { Fixtures } from "./routes/Fixtures";

// BallMark — the SayScore product mark: a minimal football on a brand roundel.
function BallMark() {
  return (
    <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7 15.3 9.4 14 13.2 10 13.2 8.7 9.4Z" fill="currentColor" stroke="none" />
      <path d="M12 3.2V7M5 9l3.4 2.4M19 9l-3.4 2.4M8 19.4l1.9-3M16 19.4l-1.9-3" />
    </svg>
  );
}

export default function App() {
  const { data: me, isLoading } = useMe();
  const logout = useLogout();

  if (isLoading) {
    return (
      <div className="app-loading" aria-busy="true" aria-label="Loading SayScore">
        <div className="app-loading__pulse" />
      </div>
    );
  }

  if (!me) {
    return (
      <main className="auth">
        <section className="auth__card" aria-labelledby="auth-title">
          <span className="auth__mark" aria-hidden="true">
            <BallMark />
          </span>
          <h1 id="auth-title" className="auth__title">SayScore</h1>
          <p className="auth__tagline">
            Predict every FIFA World Cup 2026 match and climb the SayOne leaderboard.
          </p>

          <GoogleSignInButton />

          <p className="auth__note">
            Restricted to <strong>sayonetech.com</strong> accounts.
          </p>

          <footer className="auth__org">
            <span>from</span>
            <img className="auth__org-logo" src="/sayone-logo.svg" alt="SayOne" height={18} />
          </footer>
        </section>
      </main>
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
