import { describe, it, expect } from "vitest";
import { nyDayAtHour, nyDayAtTime, nyDayKey } from "../time";

describe("nyDayKey", () => {
  it("reads an availability slot back to the NY day it was written for", () => {
    // 6 PM on Oct 15 in New York, in daylight time and in standard time.
    expect(nyDayKey(nyDayAtHour("2026-10-15", 18))).toBe("2026-10-15");
    expect(nyDayKey(nyDayAtHour("2026-12-15", 18))).toBe("2026-12-15");
  });

  it("does not let a late NY evening roll into the next UTC day", () => {
    // 11:30 PM NY on Oct 15 is 03:30Z on Oct 16.
    expect(nyDayKey("2026-10-16T03:30:00.000Z")).toBe("2026-10-15");
  });
});

describe("nyDayAtTime", () => {
  it("adds minutes to the hour-only helper", () => {
    const base = new Date(nyDayAtHour("2026-10-15", 19)).getTime();
    const later = new Date(nyDayAtTime("2026-10-15", 19, 30)).getTime();
    expect(later - base).toBe(30 * 60 * 1000);
    expect(nyDayAtTime("2026-10-15", 19, 0)).toBe(nyDayAtHour("2026-10-15", 19));
  });
});
