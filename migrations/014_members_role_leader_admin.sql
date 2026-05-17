-- migrations/014_members_role_leader_admin.sql
-- Widen the members.role CHECK to include 'leader' and 'admin'.
--
-- The dashboard already gates on these values (web/app/dashboard/page.tsx:54-57)
-- as forward-compatible, but the DB has been rejecting writes for them since
-- migration 001. The Paper Pal synthesis gate (docs/superpowers/specs/
-- 2026-05-17-paper-pal-design.md §3) lets paper leaders trigger synthesis,
-- so we now need to be able to actually persist role='leader' for the
-- member who is the meeting's leader_id.
--
-- The partial unique index `one_operator` is left in place — there is still
-- exactly one operator. 'admin' and 'leader' are uncapped.
BEGIN;

ALTER TABLE members DROP CONSTRAINT members_role_check;

ALTER TABLE members ADD CONSTRAINT members_role_check
  CHECK (role IN ('member', 'operator', 'leader', 'admin'));

COMMENT ON COLUMN members.role IS
  'One of member | operator | leader | admin. Exactly one row may have '
  'role=operator (enforced by the one_operator partial unique index). '
  'leader and admin are uncapped.';

COMMIT;
