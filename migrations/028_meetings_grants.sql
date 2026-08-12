-- migrations/028_meetings_grants.sql
-- Revoke the default full-DML grant on meetings from anon/authenticated and
-- pin it down to what the meetings_select policy actually intends: read-only
-- for signed-in members, nothing for anon.
--
-- Background: migration 002 ran `ALTER TABLE meetings ENABLE ROW LEVEL
-- SECURITY` and added exactly one policy, `meetings_select` (SELECT, TO
-- authenticated, USING true). It never touched the table's GRANTs, so
-- Supabase's default privileges — GRANT ALL ON TABLES TO anon, authenticated,
-- applied at table-creation time — were left standing. Verified live via the
-- Supabase MCP against project dmyulakudbdegwkqgelx:
--
--   SELECT grantee, privilege_type FROM information_schema.role_table_grants
--   WHERE table_schema = 'public' AND table_name = 'meetings';
--   -- anon and authenticated each hold SELECT, INSERT, UPDATE, DELETE,
--   -- TRUNCATE, REFERENCES, TRIGGER. Only one policy exists (meetings_select,
--   -- SELECT-only), confirmed via pg_policy.
--
-- Today those write grants are inert: RLS default-denies any command with no
-- matching policy, so anon/authenticated INSERT/UPDATE/DELETE against
-- meetings currently fail regardless of the GRANT. But the GRANT is the
-- ceiling on what a *future* policy can permit, and it is already the widest
-- possible ceiling. The moment anyone adds a permissive write policy to
-- meetings — even one meant to be narrowly scoped, e.g. "leader can update
-- their own meeting" — anon inherits it too unless that policy explicitly
-- excludes anon, and there is no defense-in-depth backstop from the GRANT
-- side. Fixing the GRANT now, while writes are still all-service-role, means
-- a future write policy is the only thing that can open a door, not a policy
-- plus a pre-existing blank check.
--
-- Confirmed safe: every INSERT/UPDATE/DELETE against meetings in the app goes
-- through the service-role client already (web/lib/paperpal/inbox-actions.ts
-- proposePaper's placeholder-meeting insert/delete; see its comment "meetings
-- has no member-facing INSERT/DELETE policy — the service client owns the
-- placeholder meeting's lifecycle"). No code path in web/ or scheduled_tasks/
-- writes to meetings via the anon-key + user-session client, so tightening
-- this grant changes nothing observable. service_role is unaffected either
-- way — it bypasses RLS and is not touched by this migration.
--
-- Mirrors the posture already established for members (002 REVOKE + 007
-- GRANT SELECT) and pinned for meeting_attendance (008): grants in source
-- should match intent, not whatever Supabase's default-privileges machinery
-- happened to leave behind.
BEGIN;

REVOKE ALL ON meetings FROM anon, authenticated;
GRANT SELECT ON meetings TO authenticated;

-- No INSERT privilege remains, so sequence USAGE is dead weight — revoke it
-- too rather than leaving an unused grant standing.
REVOKE USAGE, SELECT ON SEQUENCE meetings_id_seq FROM anon, authenticated;

COMMIT;

-- Post-apply verification:
--   SELECT grantee, privilege_type FROM information_schema.role_table_grants
--   WHERE table_schema = 'public' AND table_name = 'meetings'
--   ORDER BY grantee, privilege_type;
--   -- expected: anon has no rows; authenticated has exactly SELECT.
