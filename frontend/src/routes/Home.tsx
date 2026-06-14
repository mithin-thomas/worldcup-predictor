import { useState } from "react";
import { Fixtures } from "./Fixtures";
import { LeaderboardPanel } from "../components/LeaderboardPanel";

export function Home() {
  const [mobileView, setMobileView] = useState<"fixtures" | "ranks">("fixtures");

  return (
    <div className="home">
      <div className="home__toggle" aria-label="View">
        <button type="button" aria-pressed={mobileView === "fixtures"}
          className={`home__toggle-btn ${mobileView === "fixtures" ? "is-active" : ""}`} onClick={() => setMobileView("fixtures")}>
          Fixtures
        </button>
        <button type="button" aria-pressed={mobileView === "ranks"}
          className={`home__toggle-btn ${mobileView === "ranks" ? "is-active" : ""}`} onClick={() => setMobileView("ranks")}>
          Ranks
        </button>
      </div>

      <div className="home__grid">
        <div className={`home__main ${mobileView === "ranks" ? "is-hidden-mobile" : ""}`}>
          <Fixtures />
        </div>
        <aside className={`home__aside ${mobileView === "fixtures" ? "is-hidden-mobile" : ""}`}>
          <LeaderboardPanel />
        </aside>
      </div>
    </div>
  );
}
