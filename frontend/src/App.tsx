import { useRef, useState } from "react";
import { useMe, GoogleSignInButton, useLogout } from "./lib/auth";
import { Home } from "./routes/Home";
import { Admin } from "./routes/Admin";
import { HowToPlayModal } from "./components/HowToPlayModal";
import { HelpIcon } from "./components/icons";
// Auth screen: full dark wordmark logo
import sayscoreLogo from "./assets/sayscore-logo-dark.png";
// Topbar: transparent mark (works on the dark blurred glass topbar)
import sayscoreMark from "./assets/sayscore-logo-transparent.png";

// SayOne redesign shell — Predictions + Admin tabs (Bonus is embedded in Home)
type View = "predictions" | "admin";

export default function App() {
  const { data: me, isLoading } = useMe();
  const logout = useLogout();
  const [view, setView] = useState<View>("predictions");
  // Hooks must be declared unconditionally before any early return.
  const [helpOpen, setHelpOpen] = useState(false);
  const helpBtnRef = useRef<HTMLButtonElement>(null);

  // ---- Loading skeleton ----
  if (isLoading) {
    return (
      <div className="app-loading" aria-busy="true" aria-label="Loading SayScore">
        <div className="app-loading__pulse" />
      </div>
    );
  }

  // ---- Unauthenticated gate ----
  if (!me) {
    return (
      <main className="auth">
        <section className="auth__card" aria-labelledby="auth-title">
          <h1 id="auth-title" className="sr-only">SayScore</h1>
          <img
            className="auth__logo"
            src={sayscoreLogo}
            alt="SayScore, by SayOne"
          />
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

  // ---- Authenticated shell ----
  const isAdmin = me.role === "admin";

  return (
    <>
      {/* Fixed ambient radial-gradient backdrop (z-index: 0) */}
      <div className="app-bg" aria-hidden="true" />

      {/* App shell sits above the backdrop (z-index: 1) */}
      <div className="app">
        {/* ── Topbar ── */}
        <header className="topbar" role="banner">
          {/* LEFT: logo */}
          <div className="logo">
            <img
              className="logo-slot"
              src={sayscoreMark}
              alt="SayScore"
              width={132}
              height={36}
            />
          </div>

          {/* CENTER: pill nav */}
          <nav className="topbar-nav" aria-label="Main navigation">
            <button
              type="button"
              className={`nav-btn${view === "predictions" ? " on" : ""}`}
              aria-current={view === "predictions" ? "page" : undefined}
              onClick={() => setView("predictions")}
            >
              {/* Active indicator rendered as an absolutely-positioned bg layer */}
              {view === "predictions" && <span className="nav-bg" aria-hidden="true" />}
              <span className="nav-lbl">Predictions</span>
            </button>

            {isAdmin && (
              <button
                type="button"
                className={`nav-btn${view === "admin" ? " on" : ""}`}
                aria-current={view === "admin" ? "page" : undefined}
                onClick={() => setView("admin")}
              >
                {view === "admin" && <span className="nav-bg" aria-hidden="true" />}
                <span className="nav-lbl">Admin</span>
              </button>
            )}
          </nav>

          {/* RIGHT: help + user chip + logout */}
          <div className="topbar-r">
            <button
              type="button"
              ref={helpBtnRef}
              className="btn-help"
              aria-label="How to play"
              aria-haspopup="dialog"
              aria-expanded={helpOpen}
              onClick={() => setHelpOpen(true)}
            >
              <HelpIcon />
            </button>
            <div className="user-chip" aria-label={`Signed in as ${me.name || me.email}`}>
              <span>{me.name || me.email}</span>
            </div>
            <button
              type="button"
              className="btn-logout"
              onClick={() => logout.mutate()}
              disabled={logout.isPending}
              aria-label="Log out"
            >
              {logout.isPending ? "…" : "Log out"}
            </button>
          </div>
        </header>

        {/* ── Main content ── */}
        {view === "predictions" ? (
          <Home />
        ) : (
          <Admin />
        )}
      </div>

      {/* ── How to Play modal ── */}
      {helpOpen && <HowToPlayModal onClose={() => setHelpOpen(false)} />}
    </>
  );
}
