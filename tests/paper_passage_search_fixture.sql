-- Disposable container only. Stubs the parts of a Supabase project that the
-- migrations depend on (roles, auth, extensions, storage). Run by
-- tests/paper_passage_search_run.sh before every migration, in order, and then
-- the behavioral test, so RLS and grants are checked against the full schema.
\set ON_ERROR_STOP on
DO $$ BEGIN IF current_database() <> 'paperpal_retrieval_test' THEN
  RAISE EXCEPTION 'Requires disposable database'; END IF; END $$;
-- Roles are cluster-wide, so a rerun on the same server reuses them.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
CREATE SCHEMA auth;
CREATE SCHEMA extensions;
CREATE TABLE auth.users(id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
$$;
GRANT USAGE ON SCHEMA auth, extensions TO anon, authenticated, service_role;
-- Supabase installs pgvector in `extensions` and puts that schema on the
-- default search_path; 010's unqualified CREATE EXTENSION is then a no-op.
CREATE EXTENSION vector WITH SCHEMA extensions;
ALTER DATABASE paperpal_retrieval_test SET search_path = public, extensions;
-- Supabase's default privileges and the ensure_rls helper revoked by 005.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
CREATE FUNCTION public.rls_auto_enable() RETURNS void LANGUAGE sql AS 'SELECT';
-- Storage, for 018's bucket row and upload policy.
CREATE SCHEMA storage;
CREATE TABLE storage.buckets(id text PRIMARY KEY, name text NOT NULL, public boolean DEFAULT false);
CREATE TABLE storage.objects(id uuid PRIMARY KEY, bucket_id text REFERENCES storage.buckets, name text);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
