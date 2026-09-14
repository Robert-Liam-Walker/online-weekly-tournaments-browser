// Weekly schedule: every Friday at 8:00 PM America/New_York. Pure date math,
// DST-safe via the two-pass wall-clock correction.

export const WEEKLY_TIME_ZONE = "America/New_York";
export const WEEKLY_HOUR = 20; // 8 PM
export const WEEKLY_WEEKDAY = 5; // Friday (0 = Sunday)

function wallClockIn(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", weekday: "short",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const weekdayName = parts.find((p) => p.type === "weekday")?.value ?? "Sun";
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekdayName);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute"), second: get("second"), weekday };
}

/** UTC instant of `hour`:00 on the given zone-local calendar date. */
export function zonedHourToUtc(timeZone: string, year: number, month: number, day: number, hour: number): Date {
  const desired = Date.UTC(year, month - 1, day, hour, 0, 0);
  let guess = new Date(desired);
  for (let i = 0; i < 2; i++) {
    const w = wallClockIn(guess, timeZone);
    const actual = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
    guess = new Date(guess.getTime() + (desired - actual));
  }
  return guess;
}

/** The next Friday 8 PM ET strictly after `now`. */
export function nextWeeklyStart(now: Date = new Date()): Date {
  const local = wallClockIn(now, WEEKLY_TIME_ZONE);
  const daysAhead = (WEEKLY_WEEKDAY - local.weekday + 7) % 7;
  let candidate = zonedHourToUtc(WEEKLY_TIME_ZONE, local.year, local.month, local.day + daysAhead, WEEKLY_HOUR);
  if (candidate.getTime() <= now.getTime()) {
    candidate = zonedHourToUtc(WEEKLY_TIME_ZONE, local.year, local.month, local.day + daysAhead + 7, WEEKLY_HOUR);
  }
  return candidate;
}

export function weeklyTitleFor(start: Date): string {
  const d = new Intl.DateTimeFormat("en-US", { timeZone: WEEKLY_TIME_ZONE, month: "short", day: "numeric", year: "numeric" }).format(start);
  return `Weekly ${d}`;
}
