/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import { MonthCalendar } from "../MonthCalendar";
import { nyDayAtHour } from "@/lib/time";

afterEach(cleanup);

// Mirrors the seeded 2026 windows used in lib/__tests__/blackout.test.ts, so
// this render test exercises the same real-world gap: window 1 blocks
// Jul 12–31, window 2 blocks Aug 21–Sep 7, leaving Aug 1–20 bookable.
const BLACKOUT_PERIODS = [
  { range_start: nyDayAtHour("2026-07-12", 0), range_end: nyDayAtHour("2026-08-01", 0) },
  { range_start: nyDayAtHour("2026-08-21", 0), range_end: nyDayAtHour("2026-09-08", 0) },
];

describe("MonthCalendar blackout rendering", () => {
  it("disables a day inside a blackout window and leaves a bookable gap day enabled", () => {
    render(
      <MonthCalendar
        today={new Date(2026, 6, 1)}
        initialSelected={[]}
        onChange={() => {}}
        blackoutPeriods={BLACKOUT_PERIODS}
      />,
    );

    const blackedOutDay = screen.getByRole("button", {
      name: new Date(2026, 6, 15).toDateString(), // Jul 15 2026 — inside window 1
    });
    expect(blackedOutDay).toBeDisabled();

    const bookableDay = screen.getByRole("button", {
      name: new Date(2026, 7, 10).toDateString(), // Aug 10 2026 — bookable gap
    });
    expect(bookableDay).not.toBeDisabled();
  });
});
