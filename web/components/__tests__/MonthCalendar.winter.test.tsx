/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import { MonthCalendar } from "../MonthCalendar";

// Migration 039's New York midnight boundaries, expressed in UTC. Keep these
// literal values independent of the date-conversion helper used by the calendar.
const WINTER = [{
  range_start: "2026-12-19T05:00:00+00:00",
  range_end: "2027-01-04T05:00:00+00:00",
}];
const WINTER_DAYS = [
  "2026-12-19", "2026-12-20", "2026-12-21", "2026-12-22",
  "2026-12-23", "2026-12-24", "2026-12-25", "2026-12-26",
  "2026-12-27", "2026-12-28", "2026-12-29", "2026-12-30",
  "2026-12-31", "2027-01-01", "2027-01-02", "2027-01-03",
];
// The default horizon includes the current month and next month.
const DECEMBER_TODAY = new Date(2026, 11, 1, 12);

function dayButton(day: string) {
  const [year, month, date] = day.split("-").map(Number);
  return screen.getByRole("button", {
    name: new Date(year, month - 1, date).toDateString(),
    exact: true,
  });
}

afterEach(cleanup);

describe("winter blackout calendar", () => {
  it("disables December 19–January 3 while December 18 and January 4 stay enabled", () => {
    render(
      <MonthCalendar
        today={DECEMBER_TODAY}
        initialSelected={[]}
        onChange={() => {}}
        blackoutPeriods={WINTER}
      />,
    );

    expect(WINTER_DAYS).toHaveLength(16);
    for (const day of WINTER_DAYS) {
      const button = dayButton(day);
      expect(button, day).toBeDisabled();
      expect(button, day).toHaveClass("dis");
      expect(button, day).toHaveAttribute("aria-pressed", "false");
    }
    for (const day of ["2026-12-18", "2027-01-04"]) {
      expect(dayButton(day), day).toBeEnabled();
      expect(dayButton(day), day).not.toHaveClass("dis");
    }
  });

  it("ignores clicks on blocked days and allows January 4 selection", () => {
    const onChange = vi.fn();
    render(
      <MonthCalendar
        today={DECEMBER_TODAY}
        initialSelected={[]}
        onChange={onChange}
        blackoutPeriods={WINTER}
      />,
    );

    for (const day of WINTER_DAYS) fireEvent.click(dayButton(day));
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(dayButton("2027-01-04"));
    expect(onChange).toHaveBeenCalledExactlyOnceWith(["2027-01-04"]);
    expect(dayButton("2027-01-04")).toHaveAttribute("aria-pressed", "true");
  });
});
