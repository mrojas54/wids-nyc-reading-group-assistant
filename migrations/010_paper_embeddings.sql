-- migrations/010_paper_embeddings.sql
--
-- Adds pgvector extension and a paper_embeddings table to cache embeddings
-- per (paper, model). Currently consumed only by /wids-find-paper suggest
-- (model='specter_v2'). Multi-model future-proofed via the model column.

BEGIN;

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE paper_embeddings (
  paper_id   INT  NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  model      TEXT NOT NULL,
  vector     vector NOT NULL,
  cached_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (paper_id, model)
);

COMMENT ON TABLE paper_embeddings IS
  'Cached embeddings for papers, keyed by (paper, model). Model identifiers '
  'mirror the source API field names — e.g., ''specter_v2'' matches the '
  'Semantic Scholar Graph API field embedding.specter_v2.';

COMMENT ON COLUMN paper_embeddings.vector IS
  'Embedding vector. Dimension is model-dependent: 768 for specter_v2. '
  'Column is intentionally not dimension-constrained so additional models '
  '(e.g., voyage_4 at 1024) can coexist without a schema change. If/when '
  'we add ANN indexes, they go in as partial indexes per-model.';

GRANT SELECT ON paper_embeddings TO authenticated, anon;

COMMIT;
