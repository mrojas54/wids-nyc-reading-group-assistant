-- tests/papers_pdfs_bucket_rls_test.sql
--
-- Tests the RLS policy on storage.objects for the papers-pdfs bucket
-- introduced in migration 018_papers_pdfs_bucket.sql:
--
--   * Operator/admin can INSERT into <paper_id>/foo.pdf
--   * Meeting leader for that paper can INSERT into <paper_id>/foo.pdf
--   * Authenticated non-leader CANNOT INSERT
--   * Unauthenticated CANNOT INSERT
--   * INSERT to bucket root (no <paper_id>/ prefix) is REJECTED
--
-- Driven through the gate function can_synthesize_paper_pal(int) defined
-- in migration 017 (renumbered from 016 post-#52).
--
-- Run via:
--   psql "$SUPABASE_DB_URL" -f tests/papers_pdfs_bucket_rls_test.sql
--
-- Must be applied AFTER migrations 016, 017, 018. The entire test runs in
-- one transaction and ROLLBACKs at the end, leaving no fixture data behind.
--
-- Authentication: simulated by setting request.jwt.claim.sub via
-- `set_config` (matches the pattern from tests/rls.sql).

BEGIN;

-- ---- Setup fixtures ----

INSERT INTO members (id, role, name, email)
VALUES
  (91001, 'operator', 'Op Test', 'op-test@example.com'),
  (91002, 'leader',   'Leader A','leader-a@example.com'),
  (91003, 'member',   'Reader',  'reader@example.com');

INSERT INTO papers (id, title, url, abstract)
VALUES (91100, 'RLS Fixture Paper', 'http://test/rls', 'Test.');

INSERT INTO meetings (id, paper_id, leader_id, kind, scheduled_for)
VALUES (91200, 91100, 91002, 'reading_group', now() + interval '7 days');

-- Helper: set the current member ID so RLS sees a logged-in caller.
-- Mirrors how current_member_id() reads from jwt.claims (members.id stored
-- as the JWT subject). Different repos use different shims; this matches
-- the pattern in tests/rls.sql.
CREATE OR REPLACE FUNCTION pg_temp.login_as(p_member_id int) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_member_id::text, true);
  PERFORM set_config('role', 'authenticated', true);
END $$;

CREATE OR REPLACE FUNCTION pg_temp.logout() RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('role', 'anon', true);
END $$;

-- ---- Test 1: operator INSERT is allowed ----

SELECT pg_temp.login_as(91001);

DO $$
BEGIN
  INSERT INTO storage.objects (bucket_id, name, owner)
  VALUES ('papers-pdfs', '91100/test-op.pdf', '91001');

  IF NOT EXISTS (
    SELECT 1 FROM storage.objects
    WHERE bucket_id = 'papers-pdfs' AND name = '91100/test-op.pdf'
  ) THEN
    RAISE EXCEPTION 'FAIL test 1: operator INSERT did not land';
  END IF;
END $$;

-- ---- Test 2: leader of paper 91100 can INSERT ----

SELECT pg_temp.login_as(91002);

DO $$
BEGIN
  INSERT INTO storage.objects (bucket_id, name, owner)
  VALUES ('papers-pdfs', '91100/test-leader.pdf', '91002');

  IF NOT EXISTS (
    SELECT 1 FROM storage.objects
    WHERE bucket_id = 'papers-pdfs' AND name = '91100/test-leader.pdf'
  ) THEN
    RAISE EXCEPTION 'FAIL test 2: leader INSERT did not land';
  END IF;
END $$;

-- ---- Test 3: signed-in non-leader is REJECTED ----

SELECT pg_temp.login_as(91003);

DO $$
DECLARE
  v_sqlstate text;
BEGIN
  BEGIN
    INSERT INTO storage.objects (bucket_id, name, owner)
    VALUES ('papers-pdfs', '91100/test-reader.pdf', '91003');

    RAISE EXCEPTION 'FAIL test 3: non-leader INSERT was not rejected';
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN
    -- Expected: RLS rejects this with insufficient_privilege (PostgREST
    -- shape) or check_violation (raw policy WITH CHECK failure).
    NULL;
  END;
END $$;

-- ---- Test 4: anonymous INSERT is REJECTED ----

SELECT pg_temp.logout();

DO $$
BEGIN
  BEGIN
    INSERT INTO storage.objects (bucket_id, name, owner)
    VALUES ('papers-pdfs', '91100/test-anon.pdf', NULL);

    RAISE EXCEPTION 'FAIL test 4: anonymous INSERT was not rejected';
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN
    NULL;
  END;
END $$;

-- ---- Test 5: bucket-root INSERT (no <paper_id>/ prefix) is REJECTED ----

SELECT pg_temp.login_as(91001);  -- operator who *would* otherwise succeed

DO $$
BEGIN
  BEGIN
    INSERT INTO storage.objects (bucket_id, name, owner)
    VALUES ('papers-pdfs', 'rootlevel.pdf', '91001');

    RAISE EXCEPTION 'FAIL test 5: bucket-root INSERT was not rejected';
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN
    -- NULLIF(split_part('rootlevel.pdf', '/', 1), '')::int → NULL,
    -- and can_synthesize_paper_pal(NULL) → canSynthesize=false → reject.
    NULL;
  END;
END $$;

-- All assertions passed if we reach here without exception.

ROLLBACK;
