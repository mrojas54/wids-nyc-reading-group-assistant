-- tests/meetings_updated_at_test.sql
--
-- Tests migration 026: meetings.updated_at and the meetings_set_updated_at
-- trigger. Asserts that a real column change advances updated_at, that a
-- write of identical values does NOT, and that the backfill invariant
-- (updated_at >= created_at) holds on every existing row.
--
-- The no-op case is the load-bearing one. calendar-rsvp-sync treats
-- "meetings.updated_at > event.updated" as proof the database is the newer
-- write and suppresses the venue-drift alert on that basis (docs/venue-drift.md).
-- If a daily re-sync writing the same values bumped the timestamp, every row
-- would look freshly edited within a day and genuine drift would go unreported
-- — the exact 2026-08-10 failure, reintroduced through the fix for it.
--
-- Run via (ON_ERROR_STOP so a RAISE aborts psql instead of falsely reaching PASS):
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f tests/meetings_updated_at_test.sql
--
-- Single transaction, ROLLBACK at the end — no fixture data persists.

BEGIN;

DO $$
DECLARE
  v_id      int;
  v_created timestamptz;
  v_first   timestamptz;
  v_second  timestamptz;
  v_stale   int;
BEGIN
  -- Preconditions: the column and the trigger both landed.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='meetings' AND column_name='updated_at'
  ) THEN
    RAISE EXCEPTION 'FAIL: meetings.updated_at is missing — migration 026 not applied';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid='public.meetings'::regclass AND tgname='meetings_set_updated_at'
  ) THEN
    RAISE EXCEPTION 'FAIL: meetings_set_updated_at trigger is missing';
  END IF;

  -- Backfill invariant across the real table: nothing predates its own row.
  SELECT count(*) INTO v_stale FROM meetings WHERE updated_at < created_at;
  IF v_stale > 0 THEN
    RAISE EXCEPTION 'FAIL: % row(s) have updated_at < created_at', v_stale;
  END IF;

  -- Fixture: a prep-status admin meeting, far enough out to be inert.
  INSERT INTO meetings (type, status, scheduled_at, location)
  VALUES ('admin', 'prep', '2099-01-01 12:00+00', 'Fixture Venue, 1 A St, New York, NY 10001')
  RETURNING id, created_at, updated_at INTO v_id, v_created, v_first;

  IF v_first IS NULL THEN
    RAISE EXCEPTION 'FAIL: updated_at is NULL on insert — DEFAULT now() missing';
  END IF;
  IF v_first < v_created THEN
    RAISE EXCEPTION 'FAIL: fresh row has updated_at (%) < created_at (%)', v_first, v_created;
  END IF;

  -- A real change advances the timestamp.
  PERFORM pg_sleep(0.01);
  UPDATE meetings SET location = 'Moved Venue, 2 B St, New York, NY 10002' WHERE id = v_id;
  SELECT updated_at INTO v_second FROM meetings WHERE id = v_id;
  IF v_second <= v_first THEN
    RAISE EXCEPTION 'FAIL: real column change did not advance updated_at (% -> %)', v_first, v_second;
  END IF;

  -- Writing the SAME value must not. This is what keeps a daily no-op re-sync
  -- from making the database look like the newer write.
  PERFORM pg_sleep(0.01);
  UPDATE meetings SET location = 'Moved Venue, 2 B St, New York, NY 10002' WHERE id = v_id;
  IF (SELECT updated_at FROM meetings WHERE id = v_id) <> v_second THEN
    RAISE EXCEPTION 'FAIL: no-op UPDATE advanced updated_at — WHEN (OLD.* IS DISTINCT FROM NEW.*) guard is not working';
  END IF;

  -- An explicit updated_at in the statement is overridden by the trigger, so a
  -- caller cannot backdate the row past a Calendar comparison.
  PERFORM pg_sleep(0.01);
  UPDATE meetings
  SET location = 'Third Venue, 3 C St, New York, NY 10003',
      updated_at = '1999-01-01 00:00+00'
  WHERE id = v_id;
  IF (SELECT updated_at FROM meetings WHERE id = v_id) < v_second THEN
    RAISE EXCEPTION 'FAIL: caller-supplied updated_at was not overridden by the trigger';
  END IF;

  RAISE NOTICE 'PASS: meetings.updated_at advances on change, holds on no-op, and cannot be backdated';
END $$;

ROLLBACK;
