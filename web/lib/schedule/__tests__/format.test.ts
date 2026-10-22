import { describe, it, expect } from "vitest";
import {
  formatAuthors,
  formatDayAndTime,
  formatDayShort,
  formatMonthTitle,
  formatPollWindow,
  formatTimeLabel,
  joinNames,
  monthsCovering,
  parseDayKey,
  parseTimeLabel,
} from "../format";

describe("day keys", () => {
  it("formats the product's short date form", () => {
    expect(formatDayShort("2026-10-15")).toBe("Thu, Oct 15");
    expect(formatDayShort("2026-05-14")).toBe("Thu, May 14");
  });

  it("rejects impossible dates", () => {
    expect(parseDayKey("2026-02-30")).toBeNull();
    expect(parseDayKey("2026-13-01")).toBeNull();
    expect(parseDayKey("2026-1-5")).toBeNull();
    expect(parseDayKey("2028-02-29")).toEqual({ y: 2028, m: 2, d: 29 });
  });

  it("titles a month", () => {
    expect(formatMonthTitle({ y: 2026, m: 10 })).toBe("October 2026");
  });
});

describe("formatPollWindow", () => {
  it("collapses a single-month poll to one month name", () => {
    expect(formatPollWindow(["2026-10-15", "2026-10-01", "2026-10-31"])).toBe("Oct 1 – 31");
  });
  it("names both months when the poll straddles a boundary", () => {
    expect(formatPollWindow(["2026-10-31", "2026-09-18"])).toBe("Sep 18 – Oct 31");
  });
  it("is empty with no days", () => {
    expect(formatPollWindow([])).toBe("");
  });
});

describe("monthsCovering", () => {
  it("is one month for a one-month poll", () => {
    expect(monthsCovering(["2026-10-06", "2026-10-29"], { y: 2026, m: 9 })).toEqual([{ y: 2026, m: 10 }]);
  });
  it("fills every month between first and last, across a year end", () => {
    expect(monthsCovering(["2026-11-20", "2027-01-05"], { y: 2026, m: 9 })).toEqual([
      { y: 2026, m: 11 },
      { y: 2026, m: 12 },
      { y: 2027, m: 1 },
    ]);
  });
  it("falls back to the given month with no poll days", () => {
    expect(monthsCovering([], { y: 2026, m: 9 })).toEqual([{ y: 2026, m: 9 }]);
  });
});

describe("parseTimeLabel", () => {
  it("accepts the ways an operator types an evening time", () => {
    expect(parseTimeLabel("7:00 PM")).toEqual({ hour: 19, minute: 0 });
    expect(parseTimeLabel("7pm")).toEqual({ hour: 19, minute: 0 });
    expect(parseTimeLabel("7:30 pm")).toEqual({ hour: 19, minute: 30 });
    expect(parseTimeLabel("19:00")).toEqual({ hour: 19, minute: 0 });
    expect(parseTimeLabel("7")).toEqual({ hour: 19, minute: 0 });
    expect(parseTimeLabel("12:15 PM")).toEqual({ hour: 12, minute: 15 });
    expect(parseTimeLabel("12 am")).toEqual({ hour: 0, minute: 0 });
  });
  it("rejects nonsense", () => {
    expect(parseTimeLabel("")).toBeNull();
    expect(parseTimeLabel("seven")).toBeNull();
    expect(parseTimeLabel("13 pm")).toBeNull();
    expect(parseTimeLabel("7:60")).toBeNull();
    expect(parseTimeLabel("25:00")).toBeNull();
  });
  it("round-trips through the display form", () => {
    expect(formatTimeLabel(parseTimeLabel("19:30")!)).toBe("7:30 PM");
    expect(formatTimeLabel({ hour: 0, minute: 5 })).toBe("12:05 AM");
    expect(formatDayAndTime("2026-05-14", { hour: 19, minute: 0 })).toBe("Thu, May 14 · 7:00 PM");
  });
});

describe("names", () => {
  it("cites authors the way the hero card wants", () => {
    expect(formatAuthors(["Ashish Vaswani", "Noam Shazeer", "Niki Parmar"])).toBe("Vaswani et al.");
    expect(formatAuthors(["Ada Lovelace", "Grace Hopper"])).toBe("Lovelace and Hopper");
    expect(formatAuthors(["Ada Lovelace"])).toBe("Lovelace");
    expect(formatAuthors([])).toBeNull();
    expect(formatAuthors(null)).toBeNull();
  });
  it("joins names for a sentence", () => {
    expect(joinNames(["Kim"])).toBe("Kim");
    expect(joinNames(["Kim", "Lin"])).toBe("Kim and Lin");
    expect(joinNames(["Kim", "Lin", "Sam"])).toBe("Kim, Lin and Sam");
  });
});
