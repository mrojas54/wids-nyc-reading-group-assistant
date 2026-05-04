-- migrations/007_members_select_grant.sql
-- Add the missing GRANT SELECT ON members TO authenticated.
--
-- Background: 002_member_app.sql created the RLS policy
--   CREATE POLICY members_select ON members FOR SELECT TO authenticated USING (true);
-- but never granted the underlying table privilege. RLS policies only
-- constrain which rows a role sees once it has the table privilege; they do
-- not grant the privilege itself. Without the GRANT, every signed-in
-- request to read members fails with "permission denied for table members"
-- (PostgREST 42501). This breaks submitAvailability, which looks up the
-- caller's member row by auth_user_id, and any other server action that
-- reads members from the SSR client.
BEGIN;

GRANT SELECT ON members TO authenticated;

COMMIT;
