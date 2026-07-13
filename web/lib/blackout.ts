import { nyDayAtHour } from "@/lib/time";

export type BlackoutPeriod = { range_start: string; range_end: string };

/**
 * True if a member's fixed 6–9 PM ET slot for `day` (YYYY-MM-DD) overlaps any
 * blackout window. Same half-open overlap test the scheduler uses:
 * slot [s, e) is blocked iff s < period.end AND e > period.start.
 */
export function isDayBlackedOut(day: string, periods: BlackoutPeriod[]): boolean {
  const s = new Date(nyDayAtHour(day, 18)).getTime();
  const e = new Date(nyDayAtHour(day, 21)).getTime();
  return periods.some((p) => {
    const ps = new Date(p.range_start).getTime();
    const pe = new Date(p.range_end).getTime();
    return s < pe && e > ps;
  });
}

/** The subset of `days` that fall in a blackout window, in input order. */
export function blackedOutDays(days: string[], periods: BlackoutPeriod[]): string[] {
  return days.filter((d) => isDayBlackedOut(d, periods));
}
