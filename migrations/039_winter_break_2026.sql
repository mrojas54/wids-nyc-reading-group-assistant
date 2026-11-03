-- migrations/039_winter_break_2026.sql
-- Adds the 2026 winter break to blackout_periods, the same way 021 seeded the
-- two summer-break windows: no meeting may be scheduled and no member may
-- submit availability inside it.
--
-- Window: Sat Dec 19, 2026 through Sun Jan 3, 2027, inclusive (ET). Blocks the
-- two holiday weeks (Christmas and New Year's) and opens again Mon Jan 4.
--
-- Half-open [range_start, range_end) in America/New_York, so range_end is
-- midnight of the first bookable day. Re-runnable: the insert is skipped when
-- an identical window already exists.

BEGIN;

INSERT INTO blackout_periods (range_start, range_end, reason)
SELECT v.range_start, v.range_end, v.reason
FROM (VALUES
  ('2026-12-19 00:00 America/New_York'::timestamptz,
   '2027-01-04 00:00 America/New_York'::timestamptz,   -- exclusive → Jan 3 last blocked, Jan 4 bookable
   'Winter break (Dec 19, 2026 – Jan 3, 2027)')
) AS v(range_start, range_end, reason)
WHERE NOT EXISTS (
  SELECT 1 FROM blackout_periods b
  WHERE b.range_start = v.range_start AND b.range_end = v.range_end
);

COMMIT;
