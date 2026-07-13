-- migrations/022_papers_prerequisites.sql
-- Editable, AI-drafted "recommended prerequisites" bundle for a paper,
-- consumed by the new-paper-announcement email (scripts/generate_prerequisites.py).
-- Additive + nullable so existing rows and the papers RLS policies are unaffected.
BEGIN;

ALTER TABLE papers ADD COLUMN prerequisites JSONB;

COMMENT ON COLUMN papers.prerequisites IS
  'AI-drafted announcement bundle: {lede, items:[…], summary, short_title, '
  'status:"draft"|"approved", model, generated_at}. Edited before send; '
  'NULL until generated. See docs/superpowers/specs/2026-07-13-reading-group-email-and-prerequisites-design.md';

COMMIT;
