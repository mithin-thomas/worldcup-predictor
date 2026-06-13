import { useQuery } from "@tanstack/react-query";
import { getMatches } from "../lib/matches";
import { MatchRow } from "../components/MatchRow";

// Format an IST date string like "2026-06-12" to a human label e.g. "Thursday, 12 Jun"
function formatDayHeader(istDate: string): string {
  // Construct a date at midnight IST to avoid any UTC-day shift
  const dt = new Date(`${istDate}T00:00:00+05:30`);
  return dt.toLocaleDateString("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "short",
    timeZone: "Asia/Kolkata",
  });
}

function SkeletonRow() {
  return (
    <div className="skeleton-row" aria-hidden="true">
      <div className="skeleton-row__inner">
        <div className="skeleton skeleton--text skeleton--short" />
        <div className="skeleton skeleton--text skeleton--long" />
        <div className="skeleton skeleton--text skeleton--medium" />
      </div>
    </div>
  );
}

function SkeletonSection() {
  return (
    <section className="day-section" aria-hidden="true">
      <div className="skeleton skeleton--heading" />
      <SkeletonRow />
      <SkeletonRow />
      <SkeletonRow />
    </section>
  );
}

export function Fixtures() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["matches"],
    queryFn: getMatches,
  });

  if (isLoading) {
    return (
      <main className="fixtures" aria-label="Loading fixtures">
        <SkeletonSection />
        <SkeletonSection />
      </main>
    );
  }

  if (isError) {
    return (
      <main className="fixtures fixtures--empty">
        <div className="empty-state" role="alert">
          <svg
            className="empty-state__icon"
            width="48"
            height="48"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <h2 className="empty-state__title">Could not load fixtures</h2>
          <p className="empty-state__body">
            Check your connection and try again.
          </p>
          <button
            className="btn-brand"
            onClick={() => void refetch()}
            aria-label="Retry loading fixtures"
          >
            Retry
          </button>
        </div>
      </main>
    );
  }

  if (!data || data.days.length === 0) {
    return (
      <main className="fixtures fixtures--empty">
        <div className="empty-state">
          <svg
            className="empty-state__icon"
            width="48"
            height="48"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
          <h2 className="empty-state__title">No fixtures yet</h2>
          <p className="empty-state__body">
            Fixtures will appear here once the tournament schedule is confirmed.
            Check back soon.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="fixtures" aria-label="Fixtures">
      {data.days.map((day) => (
        <section key={day.date} className="day-section" aria-labelledby={`day-${day.date}`}>
          <h2 className="day-header" id={`day-${day.date}`}>
            {formatDayHeader(day.date)}
          </h2>
          <ol className="match-list" aria-label={`Matches on ${formatDayHeader(day.date)}`}>
            {day.matches.map((match) => (
              <li key={match.id} className="match-list__item">
                <MatchRow match={match} />
              </li>
            ))}
          </ol>
        </section>
      ))}
    </main>
  );
}
