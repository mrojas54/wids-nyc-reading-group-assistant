-- Disposable container only. Run before migration 035 and the behavioral test.
\set ON_ERROR_STOP on
DO $$ BEGIN IF current_database() <> 'paperpal_retrieval_test' THEN
  RAISE EXCEPTION 'Requires disposable database'; END IF; END $$;
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE SCHEMA auth;
CREATE SCHEMA extensions;
CREATE TABLE auth.users(id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
$$;
GRANT USAGE ON SCHEMA auth, extensions TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
\ir ../migrations/001_initial_schema.sql
\ir ../migrations/002_member_app.sql
\ir ../migrations/004_function_grants.sql
\ir ../migrations/008_meeting_attendance_grants.sql
\ir ../migrations/014_members_role_leader_admin.sql
\ir ../migrations/017_synthesis_gate_rpc.sql
\ir ../migrations/031_members_column_grants.sql
CREATE EXTENSION vector WITH SCHEMA extensions;
SET search_path = public, extensions;
\ir ../migrations/035_paper_passage_search.sql
