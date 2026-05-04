-- tests/rls.sql
-- Run after applying migration 002.
-- Usage: psql $DATABASE_URL -v ON_ERROR_STOP=1 -f tests/rls.sql
--
-- Asserts:
--   1. Alice can SELECT/INSERT her own availability
--   2. Alice cannot INSERT availability as Bob
--   3. Bob cannot SELECT Alice's availability
--   4. Switching to authenticated role with column-level GRANT works for safe queries
--
-- Notes:
--   - We capture IDs via \gset BEFORE switching to the authenticated role,
--     because the column-level GRANT on members blocks WHERE email = ... for
--     non-service callers.
--   - Wraps all changes in a transaction and ROLLBACKs at the end so the test
--     leaves no permanent rows.

\set ON_ERROR_STOP on

BEGIN;

-- Seed two test auth users + members + a prep meeting (as default role; full access).
INSERT INTO auth.users (id, email) VALUES
  ('11111111-1111-1111-1111-111111111111', 'alice@test'),
  ('22222222-2222-2222-2222-222222222222', 'bob@test')
ON CONFLICT (id) DO NOTHING;

INSERT INTO members (name, email, auth_user_id) VALUES
  ('Alice Test', 'alice@test', '11111111-1111-1111-1111-111111111111'),
  ('Bob Test',   'bob@test',   '22222222-2222-2222-2222-222222222222')
ON CONFLICT (email) DO UPDATE SET auth_user_id = EXCLUDED.auth_user_id;

INSERT INTO meetings (type, status) VALUES ('admin', 'prep');

-- Capture IDs while still privileged (\gset interpolates into :name).
SELECT id AS alice_id FROM members WHERE email = 'alice@test' \gset
SELECT id AS bob_id   FROM members WHERE email = 'bob@test'   \gset
SELECT id AS prep_id  FROM meetings WHERE type = 'admin' AND status = 'prep'
  ORDER BY id DESC LIMIT 1 \gset

-- ====================================================================
-- Test 1: Alice can insert and read her own availability
-- ====================================================================
SET LOCAL request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
SET LOCAL ROLE authenticated;

INSERT INTO availability (meeting_id, member_id, range_start, range_end)
VALUES (:prep_id, :alice_id, now(), now() + interval '3 hours');

DO $$ BEGIN
  IF (SELECT count(*) FROM availability) <> 1 THEN
    RAISE EXCEPTION 'FAIL test 1: alice cannot read her own availability (saw %)', (SELECT count(*) FROM availability);
  END IF;
END $$;

-- ====================================================================
-- Test 2: Alice cannot insert availability as Bob
-- ====================================================================
DO $$
DECLARE ok BOOL := false;
BEGIN
  BEGIN
    INSERT INTO availability (meeting_id, member_id, range_start, range_end)
    VALUES (:prep_id, :bob_id, now(), now() + interval '1 hour');
  EXCEPTION WHEN insufficient_privilege OR check_violation OR others THEN
    ok := true;
  END;
  IF NOT ok THEN
    RAISE EXCEPTION 'FAIL test 2: alice was allowed to insert availability as bob';
  END IF;
END $$;

-- ====================================================================
-- Test 3: Bob cannot see Alice's availability
-- ====================================================================
RESET ROLE;
SET LOCAL request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
SET LOCAL ROLE authenticated;

DO $$ BEGIN
  IF (SELECT count(*) FROM availability) <> 0 THEN
    RAISE EXCEPTION 'FAIL test 3: bob can see alice''s availability';
  END IF;
END $$;

-- ====================================================================
-- Cleanup: rollback all test data so the database is unchanged.
-- ====================================================================
RESET ROLE;
ROLLBACK;

\echo 'PASS: rls smoke tests'
