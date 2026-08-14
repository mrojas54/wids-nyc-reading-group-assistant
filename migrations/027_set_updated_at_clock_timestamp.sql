-- migrations/027_set_updated_at_clock_timestamp.sql
-- Corrects public.set_updated_at() to stamp clock_timestamp() instead of now().
--
-- 026 shipped the trigger function with now(). now() is transaction_timestamp()
-- — it returns the moment the enclosing transaction STARTED and is constant for
-- its whole duration, no matter how long the transaction runs or how many
-- statements it contains. clock_timestamp() returns the actual wall clock at the
-- moment it is evaluated.
--
-- Why that is the wrong clock here. meetings.updated_at exists for exactly one
-- question, asked by calendar-rsvp-sync Step 4b: was this row written more
-- recently than Google last touched the Calendar event? "When the transaction
-- that wrote the row began" is not an answer to that question — it is an answer
-- to a different one, and it is always early. A long-running transaction (a
-- multi-step sync, a session left open in the SQL editor) stamps a row with a
-- timestamp from minutes before the write actually happened.
--
-- The error is in the safe direction — an early updated_at makes the database
-- look OLDER than it is, and the tiebreaker only treats
-- `updated_at > event.updated` as evidence, so an early stamp under-claims and
-- surfaces a drift alert rather than suppressing one. That is why this is a
-- correction and not an incident. But "records the write time" is what the
-- column's comment promises and what the next reader will assume, so it should
-- record the write time.
--
-- Found by tests/meetings_updated_at_test.sql, which follows this repo's SQL
-- test convention (single transaction, ROLLBACK at the end, nothing persisted)
-- and therefore could not observe updated_at advance at all while the function
-- used now(): every UPDATE in the test shares one transaction and so shared one
-- timestamp. Under now(), "the trigger fired and wrote the same value" and "the
-- trigger did not fire" are indistinguishable in-transaction — which makes the
-- WHEN (OLD.* IS DISTINCT FROM NEW.*) no-op guard, the part that keeps a daily
-- re-sync from falsely advancing the timestamp, untestable. clock_timestamp()
-- makes it testable without committing fixture rows to a production table.
--
-- Idempotent and safe to re-run: CREATE OR REPLACE FUNCTION only. No DDL on
-- meetings, no trigger change (the trigger references the function by name and
-- picks this up automatically), and no data change — existing updated_at values
-- stay as they are. Nothing to confirm before applying.
--
-- Verify after applying:
--
--   SELECT prosrc LIKE '%clock_timestamp%' AS corrected FROM pg_proc p
--   JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public' AND p.proname = 'set_updated_at';
--   -- expected: t
--
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f tests/meetings_updated_at_test.sql

BEGIN;

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  -- clock_timestamp(), not now(): now() is the transaction start time and would
  -- backdate the row to before the write. See this migration's header.
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$$;

-- Re-applies the function comment from 026, which named now(). 026 has been
-- applied, so per migrations/README.md it is corrected forward rather than
-- edited in place (the same reason 025 exists).
COMMENT ON FUNCTION public.set_updated_at() IS
  'BEFORE UPDATE trigger function: stamps NEW.updated_at with clock_timestamp() '
  '— the actual write time, not now()/transaction start, which would backdate '
  'the row. Attached to meetings by migration 026; corrected by 027.';

COMMIT;
