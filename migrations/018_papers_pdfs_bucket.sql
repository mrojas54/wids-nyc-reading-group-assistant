-- migrations/018_papers_pdfs_bucket.sql
-- Creates the papers-pdfs Storage bucket and the INSERT RLS policy used
-- by the in-portal /new flow. Synthesis-eligible callers (operator/admin
-- or the paper's meeting leader) can upload to <paper_id>/<uuid>.pdf;
-- everyone else is rejected by RLS before the bytes ever touch storage.
--
-- Spec: docs/superpowers/specs/2026-05-17-paper-pal-edge-functions.md §8
-- Plan: docs/superpowers/plans/2026-05-18-paper-pal-pr2-implementation.md
--       Slice 1 (renumbered from 017 → 018 after migrations 015→016 /
--       016→017 renumber on origin/claude/paper-pal-edge-functions-pr1)
--
-- Tested by: tests/papers_pdfs_bucket_rls_test.sql
--
-- Schema notes:
--   - papers.id is INT (migration 001), so the path-prefix cast is ::int.
--   - can_synthesize_paper_pal(int) lives in migration 017
--     (was migration 016 prior to the post-#52 renumber).
--   - Object path convention is "<paper_id>/<uuid>.pdf" (spec §13.4); the
--     Edge Function also asserts this prefix when minting its signed URL.
BEGIN;

-- Create the bucket if not already present. Private (public = false):
-- reads happen via service-role signed URLs minted in the Edge Function,
-- never via anon/authenticated direct fetch.
INSERT INTO storage.buckets (id, name, public)
VALUES ('papers-pdfs', 'papers-pdfs', false)
ON CONFLICT (id) DO NOTHING;

-- INSERT: caller must satisfy can_synthesize_paper_pal(paper_id), with
-- paper_id extracted from the first path segment. NULLIF on the empty
-- string is defensive: a misbehaving client that uploads to bucket root
-- (e.g. "rootlevel.pdf" with no "<paper_id>/" prefix) would otherwise
-- error on the ::int cast and surface as 500 — instead we want it to
-- fall through to canSynthesize=false (NULL paper_id → no row match in
-- meetings, role check still works) and produce a clean 403.
CREATE POLICY "papers_pdfs_owner_or_leader_insert"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'papers-pdfs'
    AND (
      can_synthesize_paper_pal(
        NULLIF(split_part(name, '/', 1), '')::int
      ) ->> 'canSynthesize'
    )::boolean = true
  );

-- No SELECT / UPDATE / DELETE policies: the bucket is service-role-only
-- beyond this INSERT path. The Edge Function mints its own signed URLs
-- via the service role (spec §13.4), bypassing RLS entirely. The weekly
-- wids-prune-paper-pdfs scheduled task also uses the service role.

COMMIT;
