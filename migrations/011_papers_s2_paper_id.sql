-- migrations/011_papers_s2_paper_id.sql
--
-- Adds s2_paper_id (TEXT, UNIQUE, nullable) to papers so the deployed
-- /admin/suggest flow can JOIN paper_embeddings by an external identifier
-- without re-resolving via the S2 API on every request.
--
-- Existing rows get NULL; a follow-up backfill script populates them based
-- on URL matching. The resolver endpoint populates new rows on insert.

BEGIN;

ALTER TABLE papers ADD COLUMN s2_paper_id TEXT;

CREATE UNIQUE INDEX idx_papers_s2_paper_id ON papers (s2_paper_id) WHERE s2_paper_id IS NOT NULL;

COMMENT ON COLUMN papers.s2_paper_id IS
  'Canonical Semantic Scholar identifier (e.g., ARXIV:1706.03762, DOI:10.1080/...). '
  'Populated by the /api/admin/resolve-papers endpoint on insert and by a '
  'one-time backfill script for past picks. Nullable to keep historical rows '
  'valid; new inserts via the deployed flow always populate it.';

COMMIT;
