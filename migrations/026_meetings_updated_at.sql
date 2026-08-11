-- migrations/026_meetings_updated_at.sql
-- Adds meetings.updated_at (+ a BEFORE UPDATE trigger that maintains it) so
-- Calendar-vs-database conflicts on a meeting row are resolvable.
--
-- Why: scheduled_tasks/calendar-rsvp-sync reconciles a Google Calendar event
-- against its meetings row. When the two disagree — on `scheduled_at`, and as
-- of this migration on `location` too — there is no way to tell which side was
-- written more recently, because meetings carries only created_at. On
-- 2026-08-10 the operator moved meeting 37 from Jack's Wife Freda to Prince Tea
-- House on Calendar; meetings.location stayed stale for a day and the
-- pre-meeting reminder came within one step of emailing 4 members the wrong
-- restaurant. See docs/venue-drift.md.
--
-- How the timestamp is used — the comparison is ASYMMETRIC, and only one
-- direction is strong evidence:
--
--   * meetings.updated_at > event.updated  → STRONG. The database row was
--     touched after Google last recorded any change to the event, so the
--     database is the newer write and wins. calendar-rsvp-sync uses this to
--     suppress a venue-drift alert the operator has already resolved.
--   * event.updated > meetings.updated_at  → WEAK. Google bumps `updated` on
--     ANY event mutation, an attendee RSVP included, so a newer event
--     timestamp does NOT prove the location was edited on Calendar. This
--     direction must never authorize an automatic overwrite on its own.
--
-- Verify before applying:
--
--   SELECT count(*) AS rows_to_backfill FROM meetings;
--   SELECT count(*) AS already_present FROM information_schema.columns
--   WHERE table_schema='public' AND table_name='meetings'
--     AND column_name='updated_at';   -- expected: 0
--
-- ⚠ MULTI-ROW UPDATE — this migration runs `UPDATE meetings SET updated_at =
-- created_at` across every row of `meetings`. CLAUDE.md requires explicit
-- operator confirmation for any UPDATE touching >1 row of `meetings`. Read the
-- backfill below and confirm the row count from the preview above before you
-- paste this into the SQL editor. The write is idempotent (it only ever copies
-- created_at into a column that does not exist yet) and is contained in the
-- same transaction as the DDL, so a failure rolls the whole thing back.
--
-- Backfill semantics: existing rows get updated_at = created_at, NOT the
-- migration timestamp. Nobody edited these rows at migration time, and
-- created_at is a true lower bound on "last written". Migration 015 backfilled
-- availability.created_at with migration time and has carried that caveat ever
-- since; this avoids repeating it. Rows never edited since creation therefore
-- satisfy updated_at = created_at, which reads correctly.
--
-- RLS: `meetings` already exists, so the out-of-band `ensure_rls` event trigger
-- does not fire (it is an ON CREATE TABLE hook) and no new policy is needed —
-- the existing `meetings_select` policy covers the table, not a column list.
-- Grants likewise need no change: anon/authenticated/service_role hold
-- TABLE-level privileges on `meetings`, so a new column is covered
-- automatically. (Contrast migration 002, which restricted `members` to a
-- column list — that pattern would have required a GRANT here.)
--
-- PostgREST: set_updated_at() returns `trigger`, which PostgREST never exposes
-- as an RPC, so no REVOKE is needed the way migration 005 needed one for
-- rls_auto_enable().

BEGIN;

-- Nullable first so the backfill can distinguish "not yet set" from a default,
-- then defaulted + NOT NULL once every row carries a value.
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;

-- ⚠ Touches every row of meetings — see the confirmation note above.
UPDATE meetings SET updated_at = created_at WHERE updated_at IS NULL;

ALTER TABLE meetings ALTER COLUMN updated_at SET DEFAULT now();
ALTER TABLE meetings ALTER COLUMN updated_at SET NOT NULL;

COMMENT ON COLUMN meetings.updated_at IS
  'Last time any column of this row changed, maintained by the '
  'meetings_set_updated_at trigger. Backfilled from created_at in migration '
  '026, so a row never edited since creation has updated_at = created_at. '
  'Used by calendar-rsvp-sync to resolve Calendar-vs-database conflicts: only '
  'updated_at > event.updated is strong evidence (the database won the race); '
  'the reverse is not, because Google bumps event.updated on any change '
  'including attendee RSVPs.';

-- Generic enough to reuse if another table needs the same column later; today
-- meetings is the only caller and the only table in this schema with an
-- updated_at at all.
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.set_updated_at() IS
  'BEFORE UPDATE trigger function: stamps NEW.updated_at with now(). Attached '
  'to meetings by migration 026.';

-- WHEN (OLD.* IS DISTINCT FROM NEW.*) keeps a no-op UPDATE (a re-run of the
-- same sync writing an identical value) from advancing updated_at. That
-- matters: a spurious bump would make the database look like the newer write
-- and suppress a genuine venue-drift alert.
DROP TRIGGER IF EXISTS meetings_set_updated_at ON meetings;
CREATE TRIGGER meetings_set_updated_at
  BEFORE UPDATE ON meetings
  FOR EACH ROW
  WHEN (OLD.* IS DISTINCT FROM NEW.*)
  EXECUTE FUNCTION public.set_updated_at();

COMMIT;

-- After applying, regenerate the portal's generated types so
-- web/lib/database.types.ts declares the new column:
--   npx supabase gen types typescript --project-id dmyulakudbdegwkqgelx > web/lib/database.types.ts
--
-- Post-apply verification:
--   SELECT count(*) FROM meetings WHERE updated_at IS NULL;        -- expected: 0
--   SELECT count(*) FROM meetings WHERE updated_at <> created_at;  -- expected: 0 on a fresh apply
--   SELECT tgname FROM pg_trigger
--   WHERE tgrelid='public.meetings'::regclass AND NOT tgisinternal;
--   -- expected: meetings_set_updated_at
