-- tests/members_column_grants_test.sql
--
-- Tests migration 031: authenticated can read only
-- members.(id, name, role, auth_user_id), and cannot write. That is the
-- column lock 002 intended and 007 accidentally removed.
--
-- The load-bearing case is email/phone/whatsapp/vouched_by staying
-- unreadable to a member JWT — PostgREST `select=*` is the real API, not
-- the portal's narrow .select() lists.
--
-- Run via (ON_ERROR_STOP so a RAISE aborts psql instead of falsely reaching PASS):
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f tests/members_column_grants_test.sql
--
-- Single transaction, ROLLBACK at the end — no fixture data persists.
-- Privilege checks use has_*_privilege, which reads the catalog, so they
-- do not depend on a seeded member row.

BEGIN;

DO $$
DECLARE
  allowed text[] := ARRAY['id', 'name', 'role', 'auth_user_id'];
  denied  text[] := ARRAY['email', 'phone', 'whatsapp', 'active', 'vouched_by', 'joined_at'];
  writes  text[] := ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'];
  col     text;
  priv    text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'members' AND column_name = 'auth_user_id'
  ) THEN
    RAISE EXCEPTION 'FAIL: members.auth_user_id is missing — migration 002 not applied';
  END IF;

  FOREACH col IN ARRAY allowed LOOP
    IF NOT has_column_privilege('authenticated', 'public.members', col, 'SELECT') THEN
      RAISE EXCEPTION
        'FAIL: authenticated cannot SELECT members.% — migration 031 not applied, or the column list is too narrow (portal lookups need auth_user_id)',
        col;
    END IF;
  END LOOP;

  FOREACH col IN ARRAY denied LOOP
    IF has_column_privilege('authenticated', 'public.members', col, 'SELECT') THEN
      RAISE EXCEPTION
        'FAIL: authenticated can SELECT members.% — the 007 table-level SELECT is still in force; apply 031',
        col;
    END IF;
  END LOOP;

  FOREACH priv IN ARRAY writes LOOP
    IF has_table_privilege('authenticated', 'public.members', priv) THEN
      RAISE EXCEPTION
        'FAIL: authenticated still has % on members — leftover default grant; apply 031',
        priv;
    END IF;
  END LOOP;

  IF has_table_privilege('anon', 'public.members', 'SELECT') THEN
    RAISE EXCEPTION 'FAIL: anon can SELECT members — 031 should leave anon with nothing';
  END IF;
END $$;

-- Runtime check: SET ROLE authenticated and prove SELECT email is denied
-- while SELECT id, name, role, auth_user_id still works. Seed inside the
-- transaction so ROLLBACK drops the row.
INSERT INTO members (name, email, role)
VALUES ('Grant Probe', 'grant-probe@test.invalid', 'member');

SET LOCAL ROLE authenticated;

DO $$
DECLARE
  ok boolean := false;
  n  int;
BEGIN
  BEGIN
    PERFORM email FROM members;
  EXCEPTION
    WHEN insufficient_privilege THEN
      ok := true;
  END;
  IF NOT ok THEN
    RAISE EXCEPTION 'FAIL: authenticated SELECT members.email succeeded';
  END IF;

  SELECT count(id) INTO n FROM members;
  IF n < 1 THEN
    RAISE EXCEPTION 'FAIL: authenticated cannot SELECT the allowed members columns';
  END IF;
END $$;

RESET ROLE;
ROLLBACK;

\echo 'PASS: members column grants'
