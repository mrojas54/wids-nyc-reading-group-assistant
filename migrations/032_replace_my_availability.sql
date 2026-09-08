-- migrations/032_replace_my_availability.sql
-- Makes submitAvailability a single transaction, and pins one row per
-- (meeting, member, day) so two overlapping submits cannot duplicate days.
--
-- Why: web/app/availability/actions.ts deleted the caller's rows and then
-- inserted the new set as two separate PostgREST round-trips. If the insert
-- failed, the member had zero availability. Two overlapping submits both
-- deleted, then both inserted, and the table has no unique key to stop
-- duplicate day rows (meeting_attendance and volunteers already have
-- UNIQUE(meeting_id, member_id); availability cannot use that shape because
-- one submission is many day-rows).
--
-- replace_my_availability() is SECURITY DEFINER so the delete+insert commit
-- together. It binds member_id to current_member_id() — the client cannot
-- write another member's rows — and refuses anything but status='prep',
-- which the page already required but the server action did not.
--
-- Blackout rejection stays in the TypeScript action and still runs BEFORE
-- this RPC, so a rejected submit does not touch existing rows.
--
-- Verify before applying:
--
--   SELECT meeting_id, member_id, range_start, count(*)
--   FROM availability
--   GROUP BY 1, 2, 3
--   HAVING count(*) > 1;
--   -- expected: 0 rows. A non-zero result must be cleaned up before the
--   -- unique index will build.
--
-- Purely additive: one function, one unique index. No row rewrite when the
-- preview is empty. Re-runnable (CREATE OR REPLACE + IF NOT EXISTS).
--
-- After apply:
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f tests/replace_my_availability_test.sql
--   Regenerate web/lib/database.types.ts (or keep the Functions entry this
--   PR adds by hand).

BEGIN;

CREATE OR REPLACE FUNCTION public.replace_my_availability(
  p_meeting_id int,
  p_range_starts timestamptz[],
  p_range_ends timestamptz[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_member_id int;
  v_status text;
  i int;
BEGIN
  v_member_id := current_member_id();
  IF v_member_id IS NULL THEN
    RAISE EXCEPTION 'not on roster' USING ERRCODE = '42501';
  END IF;

  IF p_range_starts IS NULL OR cardinality(p_range_starts) = 0 THEN
    RAISE EXCEPTION 'select at least one day';
  END IF;

  IF cardinality(p_range_starts) IS DISTINCT FROM cardinality(p_range_ends) THEN
    RAISE EXCEPTION 'range arrays must be the same length';
  END IF;

  SELECT status INTO v_status FROM meetings WHERE id = p_meeting_id;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'no such meeting';
  END IF;
  IF v_status <> 'prep' THEN
    RAISE EXCEPTION 'meeting is not in prep';
  END IF;

  DELETE FROM availability
  WHERE meeting_id = p_meeting_id AND member_id = v_member_id;

  FOR i IN 1 .. cardinality(p_range_starts) LOOP
    IF p_range_ends[i] <= p_range_starts[i] THEN
      RAISE EXCEPTION 'range_end must be after range_start';
    END IF;
    INSERT INTO availability (meeting_id, member_id, range_start, range_end)
    VALUES (p_meeting_id, v_member_id, p_range_starts[i], p_range_ends[i]);
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.replace_my_availability(int, timestamptz[], timestamptz[]) IS
  'Atomically replace the caller''s availability rows for one prep meeting. '
  'member_id is current_member_id(); the client cannot target another member. '
  'Added in migration 032 so submitAvailability is no longer delete-then-insert '
  'across two PostgREST round-trips.';

REVOKE EXECUTE ON FUNCTION public.replace_my_availability(int, timestamptz[], timestamptz[])
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.replace_my_availability(int, timestamptz[], timestamptz[])
  TO authenticated;

CREATE UNIQUE INDEX IF NOT EXISTS availability_meeting_member_start_unique
  ON availability (meeting_id, member_id, range_start);

COMMIT;
