-- migrations/012_papers_s2_paper_id_constraint.sql
--
-- Replace the partial unique index on papers.s2_paper_id with a full UNIQUE
-- constraint so that Supabase's .upsert({ onConflict: "s2_paper_id" }) can
-- match it.  Postgres UNIQUE constraints treat NULLs as distinct, so existing
-- rows with NULL s2_paper_id are unaffected.

BEGIN;

DROP INDEX IF EXISTS idx_papers_s2_paper_id;
ALTER TABLE papers ADD CONSTRAINT uq_papers_s2_paper_id UNIQUE (s2_paper_id);

COMMIT;
