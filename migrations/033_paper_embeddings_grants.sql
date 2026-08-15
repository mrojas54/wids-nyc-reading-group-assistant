-- migrations/033_paper_embeddings_grants.sql
-- Pin paper_embeddings to service-role-only and correct the 010 comment.
--
-- 010 created the table, granted SELECT to authenticated and anon, and
-- claimed "RLS intentionally not enabled." Two things were wrong:
--
--   1. Supabase default privileges leave GRANT ALL on new public tables.
--      010 never revoked INSERT/UPDATE/DELETE, so the write ceiling was
--      wide open. The same class of leftover 030 closed on meetings.
--   2. The out-of-band ensure_rls event trigger enables RLS on every new
--      public table. 010 added no policies, so anon/authenticated already
--      see nothing — the SELECT grant is inert, and so are the leftover
--      writes. The app reads and writes this table only through the
--      service-role client (web/lib/suggest/embedding-cache.ts).
--
-- This migration makes the grants match that reality: REVOKE ALL from
-- anon/authenticated, no re-grant. RLS stays on. service_role is
-- untouched. Do not DISABLE ROW LEVEL SECURITY to "honor" the 010
-- comment — that would make leftover writes live.
--
-- COMMENT ON TABLE is the forward correction for 010's header (same
-- reason 025 exists). Do not edit 010 in place.
--
-- No row rewrite. Re-runnable.
--
-- Verify after applying:
--
--   SELECT has_table_privilege('anon', 'public.paper_embeddings', 'SELECT');
--   SELECT has_table_privilege('authenticated', 'public.paper_embeddings', 'SELECT');
--   SELECT has_table_privilege('authenticated', 'public.paper_embeddings', 'INSERT');
--   -- expected: f, f, f
--
--   SELECT relrowsecurity FROM pg_class
--   WHERE oid = 'public.paper_embeddings'::regclass;
--   -- expected: t

BEGIN;

REVOKE ALL ON paper_embeddings FROM anon, authenticated;

COMMENT ON TABLE paper_embeddings IS
  'Cached embeddings for papers, keyed by (paper, model). Model identifiers '
  'mirror the source API field names — e.g., ''specter_v2'' matches the '
  'Semantic Scholar Graph API field embedding.specter_v2. '
  'Reads and writes go through service_role (web/lib/suggest/embedding-cache.ts). '
  'RLS is on via ensure_rls with no policies, so anon/authenticated see '
  'nothing. 010 granted SELECT to anon/authenticated and claimed RLS was '
  'off; both were wrong. Corrected by migration 033.';

COMMIT;
