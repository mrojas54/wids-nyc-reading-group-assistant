-- migrations/037_papers_url_scheme.sql
-- Pins the three `papers` URL columns to schemes that are safe to render.
--
-- `papers.url` is rendered straight into an `href` by the portal — on the
-- operator-only `/admin/schedule` rail (`web/app/admin/schedule/PaperHero.tsx`)
-- and in the member-facing Paper Pal dashboard. A row holding
-- `javascript:…` or `data:text/html,…` is therefore stored XSS against
-- whoever opens the page, and on the operator rail that is the account most
-- worth stealing. `pdf_drive_url` and `companion_url` are rendered the same
-- way.
--
-- The render sites now validate the scheme (`web/lib/safeUrl.ts`) and the code
-- write paths refuse it (`web/lib/suggest/resolve-helpers.ts`,
-- `web/lib/paperpal/providers/schema.ts`, `scripts/paper_urls.py`), but the
-- live write path for `papers.url` is the raw `INSERT INTO papers (title, url,
-- …)` that `/wids-find-paper` runs on the operator's behalf. No application
-- guard sits in front of that, so the constraint belongs in the database.
--
-- `companion_url` takes the looser rule on purpose: the legacy
-- filesystem-backed companions are stored as the site-relative `/papers/<id>`.
-- `//host/…`, `/\host/…` and `/<tab>/host/…` are all excluded — each reads as
-- protocol-relative once an href parser has stripped what it strips, so none
-- is the same-origin path it looks like. Hence `[^/\\[:cntrl:]]` rather than
-- just `[^/\\]`.
--
-- `.` and `..` path segments are excluded for the same reason one step later:
-- `/.//host/…` and `/a/../..//host/…` both start with a harmless-looking
-- segment, but collapse to `//host/…`. Nothing legitimate here uses them —
-- `companion_url` is `/papers/<id>` — and a dot *inside* a segment
-- (`/papers/2.pdf`) is untouched.
--
-- Additive: three CHECK constraints, no row rewrite. The violation preview was
-- empty on the live project before applying:
--
--   SELECT id, url, pdf_drive_url, companion_url FROM papers
--   WHERE (url IS NOT NULL AND url !~* '^https?://')
--      OR (pdf_drive_url IS NOT NULL AND pdf_drive_url !~* '^https?://')
--      OR (companion_url IS NOT NULL
--          AND (companion_url !~* '^(https?://|/[^/\\[:cntrl:]])'
--               OR companion_url ~ '(^|/)\.\.?(/|$)'));
--   -- expected: 0 rows
--
-- Verify after applying:
--
--   SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--   WHERE conrelid = 'papers'::regclass AND conname LIKE 'papers_%_scheme';
--   -- expected: three rows
--
--   INSERT INTO papers (title, url) VALUES ('x', 'javascript:alert(1)');
--   -- expected: ERROR … violates check constraint "papers_url_scheme"
--
-- Regenerate web/lib/database.types.ts after applying.

BEGIN;

ALTER TABLE papers ADD CONSTRAINT papers_url_scheme
  CHECK (url IS NULL OR url ~* '^https?://');

ALTER TABLE papers ADD CONSTRAINT papers_pdf_drive_url_scheme
  CHECK (pdf_drive_url IS NULL OR pdf_drive_url ~* '^https?://');

ALTER TABLE papers ADD CONSTRAINT papers_companion_url_scheme
  CHECK (
    companion_url IS NULL
    OR (companion_url ~* '^(https?://|/[^/\\[:cntrl:]])'
        AND companion_url !~ '(^|/)\.\.?(/|$)')
  );

COMMENT ON COLUMN papers.url IS
  'Canonical link to the paper. http(s) only (papers_url_scheme): this value '
  'is rendered into an href by the portal, so any other scheme is stored XSS. '
  'See migration 037 and web/lib/safeUrl.ts.';

COMMIT;
