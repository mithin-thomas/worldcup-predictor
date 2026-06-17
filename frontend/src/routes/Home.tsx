import { useState } from "react";
import { BonusPanel } from "../components/BonusPanel";
import { MatchesColumn } from "../components/MatchesColumn";
import { StandingCard } from "../components/StandingCard";
import { LeaderboardPanel } from "../components/LeaderboardPanel";
import { HallOfFame } from "../components/HallOfFame";

type HomeMobileView = "fixtures" | "ranks";

type HomeProps = {
  mobileView?: HomeMobileView;
};

export function Home({ mobileView }: HomeProps) {
  // Mobile: toggle between "left column" (bonus + fixtures) and "ranks" (sidebar)
  const [localMobileView, setLocalMobileView] = useState<HomeMobileView>("fixtures");
  const activeMobileView = mobileView ?? localMobileView;
  const showMobileToggle = mobileView === undefined;

  return (
    <div className="home">
      {/* Mobile toggle — hidden on desktop via CSS */}
      {showMobileToggle && (
        <div className="home__toggle" role="group" aria-label="View">
          <button
            type="button"
            aria-pressed={activeMobileView === "fixtures"}
            className={`home__toggle-btn${activeMobileView === "fixtures" ? " is-active" : ""}`}
            onClick={() => setLocalMobileView("fixtures")}
          >
            Fixtures
          </button>
          <button
            type="button"
            aria-pressed={activeMobileView === "ranks"}
            className={`home__toggle-btn${activeMobileView === "ranks" ? " is-active" : ""}`}
            onClick={() => setLocalMobileView("ranks")}
          >
            Ranks
          </button>
        </div>
      )}

      <div className="mobile-page-head">
        <div className="mobile-page-title">
          {activeMobileView === "fixtures" ? "Predictions" : "Standings"}
        </div>
        <div className="mobile-page-sub">
          {activeMobileView === "fixtures"
            ? "Pick scorelines before kickoff and climb the table."
            : "Where you sit, who's leading, and the weekly winners."}
        </div>
      </div>

      {/* Two-column grid (single column on mobile) */}
      <div className="home__grid page">
        {/* LEFT: Bonus panel + Matches column */}
        <div className={`home__main main-left${activeMobileView === "ranks" ? " is-hidden-mobile" : ""}`}>
          <BonusPanel />
          <MatchesColumn />
        </div>

        {/* RIGHT: Sidebar (standing + leaderboard + hall of fame) */}
        <aside className={`home__aside main-right${activeMobileView === "fixtures" ? " is-hidden-mobile" : ""}`}>
          <StandingCard />
          <LeaderboardPanel />
          <HallOfFame />
        </aside>
      </div>
    </div>
  );
}
