/**
 * ist.ts — IST (Asia/Kolkata) date/time formatting helpers.
 *
 * The API returns UTC; all display must be converted to IST at the edge.
 * These are the canonical formatters — import from here, never inline.
 */

/** Format an ISO UTC string as IST time, e.g. "05:30 PM". */
export function istTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
    hour12: true,
  });
}

/**
 * Short date from an IST date string ("YYYY-MM-DD"), e.g. "Mon, 15 Jun".
 * Assumes the date string is already in IST (kickoff_ist.slice(0,10)).
 */
export function istShortDate(istDate: string): string {
  const dt = new Date(`${istDate}T00:00:00+05:30`);
  return dt.toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "Asia/Kolkata",
  });
}

/**
 * Relative date label for an IST date string, or null when not today/±1.
 * Returns "Today", "Tomorrow", "Yesterday", or null.
 */
export function istRelLabel(istDate: string): string | null {
  const todayIST = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  if (istDate === todayIST) return "Today";
  const dt = new Date(`${istDate}T00:00:00+05:30`).getTime();
  const today = new Date(`${todayIST}T00:00:00+05:30`).getTime();
  const diff = Math.round((dt - today) / 86_400_000);
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  return null;
}
