-- tests/blackout_periods_test.sql
--
-- Tests the blackout filter added to /wids-schedule-admin Step 2 (and reused
-- by /wids-schedule-reading-group). Asserts: a candidate slot whose start is
-- inside a blackout window is excluded, a slot outside all windows survives,
-- and the CHECK(range_end > range_start) constraint rejects inverted ranges.
--
-- Run via (ON_ERROR_STOP so a RAISE aborts psql instead of falsely reaching PASS):
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f tests/blackout_periods_test.sql
--
-- Uses far-future 2099 fixtures so it is independent of the real 2026 seed
-- rows. Single transaction, ROLLBACK at the end — no fixture data persists.

BEGIN;

-- ---- Fixtures ----
INSERT INTO members (id, name, email, active) VALUES
  (90600, 'Blackout Test A', 'blackout-a@test.invalid', true),
  (90601, 'Blackout Test B', 'blackout-b@test.invalid', true);

INSERT INTO meetings (id, type, status) VALUES
  (90500, 'admin', 'prep');

-- Member A offers a slot INSIDE the test blackout; Member B offers one OUTSIDE.
INSERT INTO availability (meeting_id, member_id, range_start, range_end) VALUES
  (90500, 90600, '2099-08-25 18:00 America/New_York', '2099-08-25 21:00 America/New_York'),
  (90500, 90601, '2099-08-10 18:00 America/New_York', '2099-08-10 21:00 America/New_York');

INSERT INTO blackout_periods (range_start, range_end, reason) VALUES
  ('2099-08-21 00:00 America/New_York', '2099-09-08 00:00 America/New_York', 'test window');

-- ---- Assertions: the exact filtered slots query from the schedule commands ----
DO $$
DECLARE
  blacked int;
  clear   int;
BEGIN
  SELECT count(*) INTO blacked FROM (
    SELECT DISTINCT av.range_start AS slot_start
    FROM availability av
    WHERE av.meeting_id = 90500
      AND NOT EXISTS (
        SELECT 1 FROM blackout_periods bp
        WHERE av.range_start < bp.range_end
          AND av.range_start + interval '90 minutes' > bp.range_start
      )
  ) s WHERE s.slot_start = TIMESTAMPTZ '2099-08-25 18:00 America/New_York';
  IF blacked <> 0 THEN
    RAISE EXCEPTION 'blacked-out slot 2099-08-25 should be excluded, found %', blacked;
  END IF;

  SELECT count(*) INTO clear FROM (
    SELECT DISTINCT av.range_start AS slot_start
    FROM availability av
    WHERE av.meeting_id = 90500
      AND NOT EXISTS (
        SELECT 1 FROM blackout_periods bp
        WHERE av.range_start < bp.range_end
          AND av.range_start + interval '90 minutes' > bp.range_start
      )
  ) s WHERE s.slot_start = TIMESTAMPTZ '2099-08-10 18:00 America/New_York';
  IF clear <> 1 THEN
    RAISE EXCEPTION 'clear slot 2099-08-10 should be present, found %', clear;
  END IF;
END $$;

-- ---- Assertion: CHECK constraint rejects an inverted range ----
DO $$
BEGIN
  BEGIN
    INSERT INTO blackout_periods (range_start, range_end)
    VALUES ('2099-01-02 00:00 America/New_York', '2099-01-01 00:00 America/New_York');
    RAISE EXCEPTION 'expected CHECK(range_end > range_start) to reject inverted range';
  EXCEPTION WHEN check_violation THEN
    NULL; -- expected
  END;
END $$;

ROLLBACK;

\echo 'blackout_periods_test: PASS'
