// Fixtures.tsx — Unit 2 redesign
// The rendering is now handled by MatchesColumn (src/components/MatchesColumn.tsx),
// which owns the Upcoming / Past toggle, date grouping, load-more, and
// MatchCard / PastRow components.
//
// This file is kept for any legacy route imports and re-exports the new MatchesColumn.
// The useQuery(["matches"]) cache is shared — MatchesColumn calls getMatches() itself.
export { MatchesColumn as Fixtures } from "../components/MatchesColumn";
