-- tests/rls.sql
-- Run after applying migrations 002 and 003.
-- Usage: psql $DATABASE_URL -v ON_ERROR_STOP=1 -f tests/rls.sql
--
-- Asserts (migration 002):
--   1. Alice can SELECT/INSERT her own availability
--   2. Alice cannot INSERT availability as Bob
--   3. Bob cannot SELECT Alice's availability
--
-- Asserts (migration 003):
--   4. Alice can read topics
--   5. Alice can read paper_topics
--   6. Alice can read paper_suggestions
--   7. Alice cannot INSERT paper_suggestion as Bob
--   8. Alice can read volunteers
--   9. Alice cannot INSERT volunteer row as Bob
--  10. Bob can see Alice's paper_suggestion + volunteer (open SELECT)
--  11. command_log is invisible to authenticated (no policy)
--
-- Notes:
--   - We capture IDs via \gset BEFORE switching to the authenticated role,
--     because the column-level GRANT on members blocks WHERE email = ... for
--     non-service callers.
--   - psql does NOT substitute :vars inside dollar-quoted blocks. We mirror
--     each :var into a custom GUC (`SET LOCAL app.<name> = :<name>`) and
--     read it inside DO $$ ... $$ blocks via current_setting('app.<name>').
--     Top-level :var references (outside DO blocks) work normally.
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

-- Mirror IDs into custom GUCs so DO blocks can read them (see header notes).
SET LOCAL app.alice_id = :alice_id;
SET LOCAL app.bob_id   = :bob_id;
SET LOCAL app.prep_id  = :prep_id;

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
DECLARE
  v_prep_id int := current_setting('app.prep_id')::int;
  v_bob_id  int := current_setting('app.bob_id')::int;
  ok BOOL := false;
BEGIN
  BEGIN
    INSERT INTO availability (meeting_id, member_id, range_start, range_end)
    VALUES (v_prep_id, v_bob_id, now(), now() + interval '1 hour');
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
-- Seed for tests 4-11 (migration 003 policies). Done as privileged role.
-- ====================================================================
RESET ROLE;

INSERT INTO topics (name) VALUES ('rls-test-topic') RETURNING id AS topic_id \gset
INSERT INTO papers (title) VALUES ('RLS Test Paper') RETURNING id AS paper_id \gset
INSERT INTO paper_topics (paper_id, topic_id) VALUES (:paper_id, :topic_id);
INSERT INTO meetings (type, status) VALUES ('reading_group', 'prep')
  RETURNING id AS rg_id \gset
INSERT INTO paper_suggestions (meeting_id, paper_id, suggested_by, source)
  VALUES (:rg_id, :paper_id, :alice_id, 'member');
INSERT INTO volunteers (meeting_id, member_id) VALUES (:rg_id, :alice_id);
INSERT INTO command_log (source, name, status)
  VALUES ('server_action', 'rls-test', 'success');

-- Mirror new IDs into GUCs (see header notes; needed inside DO blocks below).
SET LOCAL app.topic_id = :topic_id;
SET LOCAL app.paper_id = :paper_id;
SET LOCAL app.rg_id    = :rg_id;

-- Switch to alice for tests 4-9.
SET LOCAL request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
SET LOCAL ROLE authenticated;

-- ====================================================================
-- Test 4: alice can read topics
-- ====================================================================
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM topics WHERE name = 'rls-test-topic') THEN
    RAISE EXCEPTION 'FAIL test 4: alice cannot read topics';
  END IF;
END $$;

-- ====================================================================
-- Test 5: alice can read paper_topics
-- ====================================================================
DO $$
DECLARE
  v_paper_id int := current_setting('app.paper_id')::int;
  v_topic_id int := current_setting('app.topic_id')::int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM paper_topics
                 WHERE paper_id = v_paper_id AND topic_id = v_topic_id) THEN
    RAISE EXCEPTION 'FAIL test 5: alice cannot read paper_topics';
  END IF;
END $$;

-- ====================================================================
-- Test 6: alice can read paper_suggestions (open SELECT)
-- ====================================================================
DO $$
DECLARE
  v_rg_id int := current_setting('app.rg_id')::int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM paper_suggestions WHERE meeting_id = v_rg_id) THEN
    RAISE EXCEPTION 'FAIL test 6: alice cannot read paper_suggestions';
  END IF;
END $$;

-- ====================================================================
-- Test 7: alice cannot insert a paper_suggestion as bob
-- ====================================================================
DO $$
DECLARE
  v_rg_id    int := current_setting('app.rg_id')::int;
  v_paper_id int := current_setting('app.paper_id')::int;
  v_bob_id   int := current_setting('app.bob_id')::int;
  ok BOOL := false;
BEGIN
  BEGIN
    INSERT INTO paper_suggestions (meeting_id, paper_id, suggested_by, source)
    VALUES (v_rg_id, v_paper_id, v_bob_id, 'member');
  EXCEPTION WHEN insufficient_privilege OR check_violation OR others THEN
    ok := true;
  END;
  IF NOT ok THEN
    RAISE EXCEPTION 'FAIL test 7: alice was allowed to insert paper_suggestion as bob';
  END IF;
END $$;

-- ====================================================================
-- Test 8: alice can read volunteers (open SELECT)
-- ====================================================================
DO $$
DECLARE
  v_rg_id    int := current_setting('app.rg_id')::int;
  v_alice_id int := current_setting('app.alice_id')::int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM volunteers
                 WHERE meeting_id = v_rg_id AND member_id = v_alice_id) THEN
    RAISE EXCEPTION 'FAIL test 8: alice cannot read volunteers';
  END IF;
END $$;

-- ====================================================================
-- Test 9: alice cannot insert a volunteer row as bob
-- ====================================================================
DO $$
DECLARE
  v_rg_id  int := current_setting('app.rg_id')::int;
  v_bob_id int := current_setting('app.bob_id')::int;
  ok BOOL := false;
BEGIN
  BEGIN
    INSERT INTO volunteers (meeting_id, member_id) VALUES (v_rg_id, v_bob_id);
  EXCEPTION WHEN insufficient_privilege OR check_violation OR others THEN
    ok := true;
  END;
  IF NOT ok THEN
    RAISE EXCEPTION 'FAIL test 9: alice was allowed to insert volunteer as bob';
  END IF;
END $$;

-- ====================================================================
-- Test 10: bob can see alice's paper_suggestion and volunteer row
-- ====================================================================
RESET ROLE;
SET LOCAL request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
SET LOCAL ROLE authenticated;

DO $$
DECLARE
  v_rg_id    int := current_setting('app.rg_id')::int;
  v_alice_id int := current_setting('app.alice_id')::int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM paper_suggestions WHERE meeting_id = v_rg_id) THEN
    RAISE EXCEPTION 'FAIL test 10a: bob cannot see alice''s paper_suggestion';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM volunteers
                 WHERE meeting_id = v_rg_id AND member_id = v_alice_id) THEN
    RAISE EXCEPTION 'FAIL test 10b: bob cannot see alice''s volunteer row';
  END IF;
END $$;

-- ====================================================================
-- Test 11: command_log is invisible to authenticated (RLS on, no policy)
-- ====================================================================
DO $$ BEGIN
  IF (SELECT count(*) FROM command_log) <> 0 THEN
    RAISE EXCEPTION 'FAIL test 11: bob can see command_log rows';
  END IF;
END $$;

-- ====================================================================
-- Cleanup: rollback all test data so the database is unchanged.
-- ====================================================================
RESET ROLE;
ROLLBACK;

\echo 'PASS: rls smoke tests'
