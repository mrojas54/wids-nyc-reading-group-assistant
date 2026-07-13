import { describe, it, expect } from "vitest";
import { isDayBlackedOut, blackedOutDays, type BlackoutPeriod } from "../blackout";
import { nyDayAtHour } from "../time";

// Mirrors the seeded 2026 windows, expressed as NY-midnight bounds so the test
// reads in the same clock the scheduler uses.
const PERIODS: BlackoutPeriod[] = [
  { range_start: nyDayAtHour("2026-07-12", 0), range_end: nyDayAtHour("2026-08-01", 0) },
  { range_start: nyDayAtHour("2026-08-21", 0), range_end: nyDayAtHour("2026-09-08", 0) },
];

describe("isDayBlackedOut", () => {
  it("blocks a day inside window 1", () => {
    expect(isDayBlackedOut("2026-07-15", PERIODS)).toBe(true);
  });
  it("blocks a day inside window 2", () => {
    expect(isDayBlackedOut("2026-08-25", PERIODS)).toBe(true);
  });
  it("allows a day in the Aug 1–20 gap", () => {
    expect(isDayBlackedOut("2026-08-10", PERIODS)).toBe(false);
  });
  it("blocks the last day of window 1 (Jul 31) and allows the first bookable day (Aug 1)", () => {
    expect(isDayBlackedOut("2026-07-31", PERIODS)).toBe(true);
    expect(isDayBlackedOut("2026-08-01", PERIODS)).toBe(false);
  });
  it("blocks the last day of window 2 (Sep 7) and allows the first bookable day (Sep 8)", () => {
    expect(isDayBlackedOut("2026-09-07", PERIODS)).toBe(true);
    expect(isDayBlackedOut("2026-09-08", PERIODS)).toBe(false);
  });
  it("allows any day when there are no periods", () => {
    expect(isDayBlackedOut("2026-07-15", [])).toBe(false);
  });
});

describe("blackedOutDays", () => {
  it("returns only the blocked days, preserving order", () => {
    const days = ["2026-08-10", "2026-07-15", "2026-08-01", "2026-09-07"];
    expect(blackedOutDays(days, PERIODS)).toEqual(["2026-07-15", "2026-09-07"]);
  });
  it("returns [] when nothing is blocked", () => {
    expect(blackedOutDays(["2026-08-10", "2026-08-01"], PERIODS)).toEqual([]);
  });
});
