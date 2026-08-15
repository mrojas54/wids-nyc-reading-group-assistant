-- migrations/031_members_column_grants.sql
-- Restore the members column lock that 002 intended and 007 accidentally
-- removed, and pin leftover write grants the same way 030 pinned meetings.
--
-- Background: 002 revoked table-level SELECT and re-granted only
-- (id, name, role). 007 then ran `GRANT SELECT ON members TO authenticated`
-- so submitAvailability could filter on auth_user_id. In Postgres a
-- table-level SELECT includes every column, including ones added later, so
-- 007 undid the column lock. Combined with members_select (USING true), a
-- member JWT can `GET /rest/v1/members?select=*` and read email, phone,
-- whatsapp, auth_user_id, active, and vouched_by.
--
-- 023's header still claims the 002 lock is in force. That has been false
-- since 007. This migration is the forward correction — do not edit 007 or
-- 023 in place (see migrations/README.md).
--
-- 007 only needed auth_user_id on the column list. The portal's
-- authenticated client reads exactly these four columns today:
--
--   id, name, role, auth_user_id
--
--   web/app/availability/{page,actions}.ts  — id + eq(auth_user_id)
--   web/app/dashboard/rsvp-actions.ts       — id + eq(auth_user_id)
--   web/app/dashboard/page.tsx              — name, role + eq(auth_user_id)
--   web/lib/auth/requireLeaderRole.ts       — role + eq(auth_user_id)
--   web/lib/queries.ts                      — members:leader_id(name) embed
--
-- Email / active / phone / whatsapp / vouched_by stay on the service-role
-- client (requestMagicLink, auth callback, slash commands).
--
-- Also REVOKE ALL from anon and authenticated first, then re-grant the
-- column list. Supabase's default privileges leave GRANT ALL on new tables;
-- 002 only revoked SELECT, so INSERT/UPDATE/DELETE/TRUNCATE were still
-- standing. Those writes are inert today (no matching RLS policy) but they
-- are the ceiling for any future write policy — the same latent gap 030
-- closed on meetings. service_role is not touched and still bypasses both
-- GRANT and RLS.
--
-- No row rewrite, no DDL on members, no confirmation needed. Re-runnable:
-- REVOKE ALL + GRANT SELECT (columns) converge on the same privilege set.
--
-- Verify before applying:
--
--   SELECT grantee, privilege_type
--   FROM information_schema.role_table_grants
--   WHERE table_schema = 'public' AND table_name = 'members'
--     AND grantee IN ('anon', 'authenticated')
--   ORDER BY 1, 2;
--   -- expected today: authenticated has table-level SELECT (from 007)
--   -- plus leftover default write grants; anon may still hold defaults.
--
--   SELECT has_column_privilege('authenticated', 'public.members', 'email', 'SELECT');
--   -- expected today: true  (the bug)
--
-- Verify after applying:
--
--   SELECT has_column_privilege('authenticated', 'public.members', c, 'SELECT')
--   FROM unnest(ARRAY['id','name','role','auth_user_id','email','phone',
--                     'whatsapp','active','vouched_by','joined_at']) AS c;
--   -- expected: true, true, true, true, false, false, false, false, false, false
--
--   SELECT has_table_privilege('authenticated', 'public.members', p)
--   FROM unnest(ARRAY['INSERT','UPDATE','DELETE','TRUNCATE']) AS p;
--   -- expected: all false
--
--   SELECT has_table_privilege('anon', 'public.members', 'SELECT');
--   -- expected: false
--
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f tests/members_column_grants_test.sql

BEGIN;

REVOKE ALL ON members FROM anon, authenticated;
GRANT SELECT (id, name, role, auth_user_id) ON members TO authenticated;

-- No INSERT privilege remains, so sequence USAGE is dead weight — revoke it
-- too rather than leaving an unused grant standing.
REVOKE USAGE, SELECT ON SEQUENCE members_id_seq FROM anon, authenticated;

COMMIT;
