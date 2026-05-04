-- migrations/008_meeting_attendance_grants.sql
-- Pin the meeting_attendance GRANTs in source.
--
-- Background: meeting_attendance had RLS policies in 002_member_app.sql
-- (attendance_select_own, attendance_insert_own, attendance_update_own) but
-- no migration explicitly granted the underlying table privileges. Unlike
-- members (which 002 actively REVOKE'd, requiring the 007 fix-up), this table
-- still had INSERT/SELECT/UPDATE for authenticated via Supabase's default
-- privileges on public.*, so setRsvp would have worked without this migration.
--
-- We're pinning the grants in source anyway:
--   - same source-of-truth posture as 006 (phone CHECK constraints applied
--     out-of-band, then committed) and 007 (the actual gap fix on members);
--   - removes our reliance on whatever Supabase's default-privileges machinery
--     happens to do today for tables we'll add later;
--   - idempotent — re-running against a table that already has these grants
--     is a no-op.
--
-- The sequence grant is here for the same reason: even though INSERT was
-- already working, the sequence USAGE/SELECT requirement is implicit and
-- worth pinning explicitly for any future SERIAL column we add.
BEGIN;

GRANT SELECT, INSERT, UPDATE ON meeting_attendance TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE meeting_attendance_id_seq TO authenticated;

COMMIT;
