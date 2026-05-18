import { describe, it, expect } from "vitest";
import { endOfNextMonth } from "../MonthCalendar";

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
