import { useEffect, useRef, useState } from "react";
import { useMe, GoogleSignInButton, useLogout } from "./lib/auth";
import { Home } from "./routes/Home";
import { Admin } from "./routes/Admin";
import { HowToPlayModal } from "./components/HowToPlayModal";
import { ChevronDownIcon, HelpIcon, LogOutIcon, ShieldTabIcon, SparkIcon, StandingsIcon } from "./components/icons";
import { Avatar } from "./components/Avatar";
// Auth screen: full dark wordmark logo
import sayscoreLogo from "./assets/sayscore-logo-dark.png";
// Topbar: transparent mark (works on the dark blurred glass topbar)
import sayscoreMark from "./assets/sayscore-logo-transparent.png";

// SayOne redesign shell — Predictions + Admin tabs (Bonus is embedded in Home)
type View = "predictions" | "admin";
type MobileTab = "predict" | "standings" | "admin";

function useIsPhone() {
  const [isPhone, setIsPhone] = useState(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia("(max-width: 760px)").matches;
  });

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const media = window.matchMedia("(max-width: 760px)");
    const update = () => setIsPhone(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  return isPhone;
}

export default function App() {
  const { data: me, isLoading } = useMe();
  const logout = useLogout();
  const [view, setView] = useState<View>("predictions");
  const [mobileTab, setMobileTab] = useState<MobileTab>("predict");
  const isPhone = useIsPhone();
  // Hooks must be declared unconditionally before any early return.
  const [helpOpen, setHelpOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [logoutConfirm, setLogoutConfirm] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);
  const isAdmin = me?.role === "admin";

  useEffect(() => {
    if (!profileOpen) return;

    function closeMenu() {
      setProfileOpen(false);
      setLogoutConfirm(false);
    }

    function onPointerDown(event: PointerEvent) {
      if (!profileRef.current?.contains(event.target as Node)) {
        closeMenu();
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") closeMenu();
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [profileOpen]);

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
  const effectiveMobileTab: MobileTab = isAdmin || mobileTab !== "admin" ? mobileTab : "predict";
  const effectiveView: View = isAdmin || view !== "admin" ? view : "predictions";
  const activeView: View = isPhone
    ? effectiveMobileTab === "admin" ? "admin" : "predictions"
    : effectiveView;
  const homeMobileView = isPhone
    ? effectiveMobileTab === "standings" ? "ranks" : "fixtures"
    : undefined;
  const userName = me.name || me.email;

  function selectMobileTab(tab: MobileTab) {
    if (tab === "admin" && !isAdmin) return;
    setMobileTab(tab);
    setView(tab === "admin" ? "admin" : "predictions");
  }

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
              className={`nav-btn${activeView === "predictions" ? " on" : ""}`}
              aria-current={activeView === "predictions" ? "page" : undefined}
              onClick={() => setView("predictions")}
            >
              {/* Active indicator rendered as an absolutely-positioned bg layer */}
              {activeView === "predictions" && <span className="nav-bg" aria-hidden="true" />}
              <span className="nav-lbl">Predictions</span>
            </button>

            {isAdmin && (
              <button
                type="button"
                className={`nav-btn${activeView === "admin" ? " on" : ""}`}
                aria-current={activeView === "admin" ? "page" : undefined}
                onClick={() => setView("admin")}
              >
                {activeView === "admin" && <span className="nav-bg" aria-hidden="true" />}
                <span className="nav-lbl">Admin</span>
              </button>
            )}
          </nav>

          {/* RIGHT: profile menu */}
          <div className="topbar-r">
            <div className="topbar-profile" ref={profileRef}>
              <button
                type="button"
                className="profile-trigger"
                aria-label={`Profile menu for ${userName}`}
                aria-haspopup="menu"
                aria-expanded={profileOpen}
                aria-controls="profile-menu"
                onClick={() => {
                  setProfileOpen((open) => !open);
                  setLogoutConfirm(false);
                }}
              >
                <Avatar name={userName} avatarUrl={me.avatar_url || undefined} size={32} isMe />
                <span className="profile-trigger__text">
                  <span className="profile-trigger__name">{userName}</span>
                  <span className="profile-trigger__role">{isAdmin ? "Admin" : "Player"}</span>
                </span>
                <span className="profile-trigger__chev" aria-hidden="true">
                  <ChevronDownIcon />
                </span>
              </button>

              {profileOpen && (
                <div id="profile-menu" className="profile-menu" role="menu">
                  <div className="profile-menu__identity" aria-label={`Signed in as ${userName}`}>
                    <span className="profile-menu__name">{userName}</span>
                    <span className="profile-menu__email">{me.email}</span>
                  </div>
                  <button
                    type="button"
                    className="profile-menu__item"
                    role="menuitem"
                    onClick={() => {
                      setProfileOpen(false);
                      setLogoutConfirm(false);
                      setHelpOpen(true);
                    }}
                  >
                    <HelpIcon />
                    <span>How to play</span>
                  </button>
                  {!logoutConfirm ? (
                    <button
                      type="button"
                      className="profile-menu__item profile-menu__item--danger"
                      role="menuitem"
                      onClick={() => setLogoutConfirm(true)}
                    >
                      <LogOutIcon />
                      <span>Log out</span>
                    </button>
                  ) : (
                    <div
                      className="profile-menu__confirm"
                      role="group"
                      aria-label="Confirm log out"
                    >
                      <p className="profile-menu__confirm-text">Log out of SayScore?</p>
                      <div className="profile-menu__confirm-row">
                        <button
                          type="button"
                          className="profile-menu__cancel"
                          onClick={() => setLogoutConfirm(false)}
                          disabled={logout.isPending}
                          autoFocus
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          className="profile-menu__confirm-danger"
                          onClick={() => logout.mutate()}
                          disabled={logout.isPending}
                        >
                          {logout.isPending ? "Logging out…" : "Log out"}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </header>

        {/* ── Main content ── */}
        {activeView === "predictions" ? (
          <Home mobileView={homeMobileView} />
        ) : (
          <Admin />
        )}

        <nav className="mobile-tabbar" aria-label="Primary mobile navigation">
          <button
            type="button"
            className={`mobile-tab${effectiveMobileTab === "predict" ? " on" : ""}`}
            aria-current={effectiveMobileTab === "predict" ? "page" : undefined}
            onClick={() => selectMobileTab("predict")}
          >
            <span className="mobile-tab__icon"><SparkIcon /></span>
            <span>Predict</span>
          </button>

          <button
            type="button"
            className={`mobile-tab${effectiveMobileTab === "standings" ? " on" : ""}`}
            aria-current={effectiveMobileTab === "standings" ? "page" : undefined}
            onClick={() => selectMobileTab("standings")}
          >
            <span className="mobile-tab__icon"><StandingsIcon /></span>
            <span>Standings</span>
          </button>

          {isAdmin && (
            <button
              type="button"
              className={`mobile-tab${effectiveMobileTab === "admin" ? " on" : ""}`}
              aria-current={effectiveMobileTab === "admin" ? "page" : undefined}
              onClick={() => selectMobileTab("admin")}
            >
              <span className="mobile-tab__icon"><ShieldTabIcon /></span>
              <span>Admin</span>
            </button>
          )}
        </nav>
      </div>

      {/* ── How to Play modal ── */}
      {helpOpen && <HowToPlayModal onClose={() => setHelpOpen(false)} />}
    </>
  );
}
