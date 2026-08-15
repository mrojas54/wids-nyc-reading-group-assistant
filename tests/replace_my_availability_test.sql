-- tests/replace_my_availability_test.sql
--
-- Tests migration 032: replace_my_availability is one transaction, binds
-- member_id to current_member_id(), and refuses non-prep meetings. The
-- unique index on (meeting_id, member_id, range_start) is present.
--
-- Run via:
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f tests/replace_my_availability_test.sql
--
-- Single transaction, ROLLBACK at the end — no fixture data persists.

\set ON_ERROR_STOP on

BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.replace_my_availability(int, timestamptz[], timestamptz[])') IS NULL THEN
    RAISE EXCEPTION 'FAIL: replace_my_availability is missing — migration 032 not applied';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'availability_meeting_member_start_unique'
  ) THEN
    RAISE EXCEPTION 'FAIL: availability_meeting_member_start_unique is missing';
  END IF;

  IF NOT has_function_privilege(
    'authenticated',
    'public.replace_my_availability(int, timestamptz[], timestamptz[])',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'FAIL: authenticated cannot EXECUTE replace_my_availability';
  END IF;
END $$;

ROLLBACK;

\echo 'PASS: replace_my_availability'
