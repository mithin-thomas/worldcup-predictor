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
 */
export function currentISTMonday(): string {
  const now = new Date();
  // Get the current IST date string
  const istDate = now.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const dt = new Date(`${istDate}T00:00:00+05:30`);
  // getDay() in the IST locale: we need the IST weekday
  const istDay = parseInt(
    now.toLocaleDateString("en-US", { timeZone: "Asia/Kolkata", weekday: "short" }).slice(0, 1),
    10,
  );
  // Use a reliable approach: compute days since Monday
  const dayOfWeek = dt.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  void istDay; // suppress unused warning
  const monday = new Date(dt.getTime() - daysFromMonday * 86_400_000);
  return monday.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
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
