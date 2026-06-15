import { useState } from "react";
import { BonusPanel } from "../components/BonusPanel";
import { MatchesColumn } from "../components/MatchesColumn";
import { StandingCard } from "../components/StandingCard";
import { LeaderboardPanel } from "../components/LeaderboardPanel";
import { HallOfFame } from "../components/HallOfFame";

export function Home() {
  // Mobile: toggle between "left column" (bonus + fixtures) and "ranks" (sidebar)
  const [mobileView, setMobileView] = useState<"fixtures" | "ranks">("fixtures");

  return (
    <div className="home">
      {/* Mobile toggle — hidden on desktop via CSS */}
      <div className="home__toggle" aria-label="View">
        <button
          type="button"
          aria-pressed={mobileView === "fixtures"}
          className={`home__toggle-btn${mobileView === "fixtures" ? " is-active" : ""}`}
          onClick={() => setMobileView("fixtures")}
        >
          Fixtures
        </button>
        <button
          type="button"
          aria-pressed={mobileView === "ranks"}
          className={`home__toggle-btn${mobileView === "ranks" ? " is-active" : ""}`}
          onClick={() => setMobileView("ranks")}
        >
          Ranks
        </button>
      </div>

      {/* Two-column grid (single column on mobile) */}
      <div className="home__grid page">
        {/* LEFT: Bonus panel + Matches column */}
        <div className={`home__main main-left${mobileView === "ranks" ? " is-hidden-mobile" : ""}`}>
          <BonusPanel />
          <MatchesColumn />
        </div>

        {/* RIGHT: Sidebar (standing + leaderboard + hall of fame) */}
        <aside className={`home__aside main-right${mobileView === "fixtures" ? " is-hidden-mobile" : ""}`}>
          <StandingCard />
          <LeaderboardPanel />
          <HallOfFame />
        </aside>
      </div>
    </div>
  );
}
