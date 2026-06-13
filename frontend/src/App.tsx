import { useMe, GoogleSignInButton, useLogout } from "./lib/auth";
import { Fixtures } from "./routes/Fixtures";
import sayscoreLogo from "./assets/sayscore-logo-dark.png";
import sayscoreMark from "./assets/sayscore-logo-transparent.png";

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
          <h1 id="auth-title" className="sr-only">SayScore</h1>
          <img className="auth__logo" src={sayscoreLogo} alt="SayScore, by SayOne" />
          <p className="auth__tagline">
            Predict every FIFA World Cup 2026 match and climb the SayOne leaderboard.
          </p>

          <GoogleSignInButton />

          <p className="auth__note">
            Restricted to <strong>sayonetech.com</strong> accounts.
          </p>
        </section>
      </main>
    );
  }

  return (
    <div className="app-shell">
      <header className="topbar" role="banner">
        <img className="topbar__logo" src={sayscoreMark} alt="SayScore" height={24} />
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
