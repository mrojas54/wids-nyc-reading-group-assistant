-- migrations/008_meeting_attendance_grants.sql
-- Add the missing GRANTs on meeting_attendance for authenticated.
--
-- Background: 002_member_app.sql created RLS policies on meeting_attendance
-- (attendance_select_own, attendance_insert_own, attendance_update_own) but
-- never granted the underlying table privileges. RLS only constrains rows once
-- the privilege exists; without the GRANTs, every signed-in upsert from
-- setRsvp returns "permission denied for table meeting_attendance"
-- (PostgREST 42501). Same latent failure mode as migration 007 fixed for
-- members. The sequence grant is required because meeting_attendance.id is
-- SERIAL and INSERT needs USAGE/SELECT on the underlying sequence.
BEGIN;

GRANT SELECT, INSERT, UPDATE ON meeting_attendance TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE meeting_attendance_id_seq TO authenticated;

COMMIT;
