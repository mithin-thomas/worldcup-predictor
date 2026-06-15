/**
 * ist.ts — IST (Asia/Kolkata) date/time formatting helpers.
 *
 * The API returns UTC; all display must be converted to IST at the edge.
 * These are the canonical formatters — import from here, never inline.
 */

/**
 * weekRange renders the IST Mon–Sun span for a week_start (YYYY-MM-DD, the IST
 * calendar Monday). E.g. "25–31 May 2026", or "29 Jun – 5 Jul 2026" across a
 * month boundary. Times are converted at the edge to IST, never shown as raw UTC.
 */
export function weekRange(weekStart: string): string {
  const start = new Date(`${weekStart}T00:00:00+05:30`);
  const end = new Date(start.getTime() + 6 * 86_400_000); // Sunday = Monday + 6d
  const part = (d: Date, opts: Intl.DateTimeFormatOptions) =>
    d.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", ...opts });
  const startMonth = part(start, { month: "short" });
  const endMonth = part(end, { month: "short" });
  const year = part(end, { year: "numeric" });
  return startMonth === endMonth
    ? `${part(start, { day: "numeric" })}–${part(end, { day: "numeric" })} ${endMonth} ${year}`
    : `${part(start, { day: "numeric", month: "short" })} – ${part(end, { day: "numeric", month: "short" })} ${year}`;
}

/**
 * Returns the current IST calendar Monday as a "YYYY-MM-DD" string.
 * Used to detect whether a week_start is "this week".
 *
 * Derives the weekday in IST explicitly — never uses Date#getDay() which
 * returns the weekday in the host (browser/CI) timezone, causing off-by-one
 * errors on machines west of UTC+5:30 near a day boundary.
 */
export function currentISTMonday(): string {
  // Step 1: get today's date string in IST (YYYY-MM-DD)
  const todayIST = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

  // Step 2: construct an IST-anchored Date so we can ask for the weekday in IST
  const todayIST_dt = new Date(`${todayIST}T00:00:00+05:30`);
  const weekdayShort = todayIST_dt.toLocaleDateString("en-US", {
    timeZone: "Asia/Kolkata",
    weekday: "short",
  }); // "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun"

  // Days-from-Monday (Mon=0 … Sun=6) in IST
  const order: Record<string, number> = {
    Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6,
  };
  const daysFromMonday = order[weekdayShort] ?? 0;

  // Step 3: subtract those days in ms to land on Monday at 00:00 IST
  const monday = new Date(todayIST_dt.getTime() - daysFromMonday * 86_400_000);
  return monday.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }); // YYYY-MM-DD
}

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
