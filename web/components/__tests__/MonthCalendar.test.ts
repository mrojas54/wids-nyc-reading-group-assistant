import { describe, it, expect } from "vitest";
import {
  endOfNextMonth,
  parseLocalDay,
  pruneToWindow,
} from "../MonthCalendar";

// Regression guard for the availability horizon. The original calendar used
// a 30-day rolling window which felt arbitrary: a member opening the portal
// on May 17 could only see up to June 16, even though the next reading group
// might be later in June. The new semantic is "the rest of this month + all
// of next month" — boundary-anchored rather than count-anchored.

describe("endOfNextMonth", () => {
  it("returns June 30 when today is mid-May (the bug reported by users)", () => {
    const may17 = new Date(2026, 4, 17); // months are 0-indexed
    const end = endOfNextMonth(may17);
    expect(end.getFullYear()).toBe(2026);
    expect(end.getMonth()).toBe(5); // June
    expect(end.getDate()).toBe(30);
  });

  it("returns June 30 when today is May 1 (start of month edge)", () => {
    const may1 = new Date(2026, 4, 1);
    const end = endOfNextMonth(may1);
    expect(end.getMonth()).toBe(5);
    expect(end.getDate()).toBe(30);
  });

  it("returns June 30 when today IS the last day of May (last day edge)", () => {
    const may31 = new Date(2026, 4, 31);
    const end = endOfNextMonth(may31);
    expect(end.getMonth()).toBe(5);
    expect(end.getDate()).toBe(30);
  });

  it("handles February in a non-leap year (28-day month)", () => {
    const jan15_2027 = new Date(2027, 0, 15);
    const end = endOfNextMonth(jan15_2027);
    expect(end.getMonth()).toBe(1); // February
    expect(end.getDate()).toBe(28); // 2027 is not a leap year
  });

  it("handles February in a leap year (29-day month)", () => {
    const jan15_2028 = new Date(2028, 0, 15);
    const end = endOfNextMonth(jan15_2028);
    expect(end.getMonth()).toBe(1);
    expect(end.getDate()).toBe(29);
  });

  it("rolls over the year correctly in December", () => {
    const dec20 = new Date(2026, 11, 20);
    const end = endOfNextMonth(dec20);
    expect(end.getFullYear()).toBe(2027);
    expect(end.getMonth()).toBe(0); // January
    expect(end.getDate()).toBe(31);
  });

  it("rolls over the year correctly in November (next month is December)", () => {
    const nov15 = new Date(2026, 10, 15);
    const end = endOfNextMonth(nov15);
    expect(end.getFullYear()).toBe(2026);
    expect(end.getMonth()).toBe(11); // December
    expect(end.getDate()).toBe(31);
  });
});

describe("parseLocalDay", () => {
  it("parses well-formed YYYY-MM-DD into a local-midnight Date", () => {
    const d = parseLocalDay("2026-06-09");
    expect(d).not.toBeNull();
    expect(d!.getFullYear()).toBe(2026);
    expect(d!.getMonth()).toBe(5);
    expect(d!.getDate()).toBe(9);
    expect(d!.getHours()).toBe(0);
  });

  it("returns null for malformed keys", () => {
    expect(parseLocalDay("2026-6-9")).toBeNull();
    expect(parseLocalDay("garbage")).toBeNull();
    expect(parseLocalDay("")).toBeNull();
  });
});

describe("pruneToWindow", () => {
  // Reproduces the stuck-counter bug from preview testing: stale rows in
  // the availability table leak into pre-fill as dates outside the current
  // selectable window. The calendar renders them as disabled cells (no
  // magenta, no click handler), so the user can't deselect them — yet
  // they still count toward "N days selected".
  const today = new Date(2026, 4, 17); // May 17
  const horizonEnd = new Date(2026, 5, 30); // June 30

  it("keeps keys inside the window", () => {
    const keys = ["2026-05-17", "2026-06-09", "2026-06-30"];
    expect(pruneToWindow(keys, today, horizonEnd)).toEqual(keys);
  });

  it("drops keys before today (the stuck-counter case)", () => {
    const keys = ["2026-05-10", "2026-05-15", "2026-06-09"];
    expect(pruneToWindow(keys, today, horizonEnd)).toEqual(["2026-06-09"]);
  });

  it("drops keys after horizonEnd", () => {
    const keys = ["2026-06-09", "2026-07-01", "2026-12-25"];
    expect(pruneToWindow(keys, today, horizonEnd)).toEqual(["2026-06-09"]);
  });

  it("dedupes duplicates while preserving first-seen order", () => {
    const keys = ["2026-06-09", "2026-05-20", "2026-06-09", "2026-05-20"];
    expect(pruneToWindow(keys, today, horizonEnd)).toEqual([
      "2026-06-09",
      "2026-05-20",
    ]);
  });

  it("silently drops malformed keys instead of throwing", () => {
    const keys = ["2026-06-09", "not-a-date", "", "2026-06-10"];
    expect(pruneToWindow(keys, today, horizonEnd)).toEqual([
      "2026-06-09",
      "2026-06-10",
    ]);
  });

  it("treats today and horizonEnd as inclusive boundaries", () => {
    expect(pruneToWindow(["2026-05-17"], today, horizonEnd)).toEqual([
      "2026-05-17",
    ]);
    expect(pruneToWindow(["2026-06-30"], today, horizonEnd)).toEqual([
      "2026-06-30",
    ]);
  });

  it("returns an empty array when given empty input", () => {
    expect(pruneToWindow([], today, horizonEnd)).toEqual([]);
  });
});
