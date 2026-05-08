-- tests/pick_topic_tagging_test.sql
--
-- Tests the SQL pattern used by /wids-find-paper pick step 4d.5 (topic
-- auto-tagging at commit time). Specifically: the case-insensitive name
-- match, hallucination drop, ON CONFLICT idempotence, and behavior with
-- an empty topics list.
--
-- Run via:
--   psql "$SUPABASE_DB_URL" -f tests/pick_topic_tagging_test.sql
--
-- All assertions use DO blocks that RAISE EXCEPTION on failure. The
-- entire test runs in a single transaction that ROLLBACKs at the end,
-- leaving no fixture data behind.

BEGIN;

-- ---- Setup fixtures ----

INSERT INTO papers (id, title, url, abstract)
VALUES (90001, 'Test Paper for Tagging', 'http://test/tagging', 'Test abstract.');

INSERT INTO topics (id, name) VALUES
  (90010, 'Time Series Forecasting'),
  (90011, 'Causal Inference'),
  (90012, 'LLM Evaluation');

-- ---- Test 1: case-insensitive match inserts the right topic ----

INSERT INTO paper_topics (paper_id, topic_id)
SELECT 90001, t.id
FROM topics t
WHERE LOWER(t.name) = ANY(ARRAY['time series forecasting']::text[])
ON CONFLICT (paper_id, topic_id) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM paper_topics WHERE paper_id = 90001 AND topic_id = 90010
  ) THEN
    RAISE EXCEPTION 'FAIL test 1: case-insensitive match did not insert';
  END IF;
  IF (SELECT COUNT(*) FROM paper_topics WHERE paper_id = 90001) <> 1 THEN
    RAISE EXCEPTION 'FAIL test 1: expected exactly 1 row, got %',
      (SELECT COUNT(*) FROM paper_topics WHERE paper_id = 90001);
  END IF;
END $$;

-- ---- Test 2: hallucinated name inserts zero rows ----

INSERT INTO paper_topics (paper_id, topic_id)
SELECT 90001, t.id
FROM topics t
WHERE LOWER(t.name) = ANY(ARRAY['quantum computing']::text[])
ON CONFLICT (paper_id, topic_id) DO NOTHING;

DO $$
BEGIN
  IF (SELECT COUNT(*) FROM paper_topics WHERE paper_id = 90001) <> 1 THEN
    RAISE EXCEPTION 'FAIL test 2: hallucination should not insert; have % rows',
      (SELECT COUNT(*) FROM paper_topics WHERE paper_id = 90001);
  END IF;
END $$;

-- ---- Test 3: ON CONFLICT keeps the table clean on re-suggest ----

INSERT INTO paper_topics (paper_id, topic_id)
SELECT 90001, t.id
FROM topics t
WHERE LOWER(t.name) = ANY(ARRAY['time series forecasting']::text[])
ON CONFLICT (paper_id, topic_id) DO NOTHING;

DO $$
BEGIN
  IF (SELECT COUNT(*) FROM paper_topics WHERE paper_id = 90001 AND topic_id = 90010) <> 1 THEN
    RAISE EXCEPTION 'FAIL test 3: ON CONFLICT should keep exactly 1 row';
  END IF;
END $$;

-- ---- Test 4: multi-topic insert (2 of 3 valid) ----

-- Reset for this test
DELETE FROM paper_topics WHERE paper_id = 90001;

INSERT INTO paper_topics (paper_id, topic_id)
SELECT 90001, t.id
FROM topics t
WHERE LOWER(t.name) = ANY(
  ARRAY['causal inference', 'llm evaluation', 'made-up topic']::text[]
)
ON CONFLICT (paper_id, topic_id) DO NOTHING;

DO $$
BEGIN
  IF (SELECT COUNT(*) FROM paper_topics WHERE paper_id = 90001) <> 2 THEN
    RAISE EXCEPTION 'FAIL test 4: expected 2 valid rows, got %',
      (SELECT COUNT(*) FROM paper_topics WHERE paper_id = 90001);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM paper_topics WHERE paper_id = 90001 AND topic_id = 90011
  ) THEN
    RAISE EXCEPTION 'FAIL test 4: missing causal inference topic';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM paper_topics WHERE paper_id = 90001 AND topic_id = 90012
  ) THEN
    RAISE EXCEPTION 'FAIL test 4: missing llm evaluation topic';
  END IF;
END $$;

-- ---- Test 5: empty validated names array inserts zero rows ----

DELETE FROM paper_topics WHERE paper_id = 90001;

INSERT INTO paper_topics (paper_id, topic_id)
SELECT 90001, t.id
FROM topics t
WHERE LOWER(t.name) = ANY(ARRAY[]::text[])
ON CONFLICT (paper_id, topic_id) DO NOTHING;

DO $$
BEGIN
  IF (SELECT COUNT(*) FROM paper_topics WHERE paper_id = 90001) <> 0 THEN
    RAISE EXCEPTION 'FAIL test 5: empty array should insert no rows';
  END IF;
END $$;

-- ---- Cleanup: rollback all fixtures ----

ROLLBACK;

-- If we reach here without raising, all tests passed.
\echo 'pick_topic_tagging_test.sql: all tests passed'
