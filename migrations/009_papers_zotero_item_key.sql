-- migrations/009_papers_zotero_item_key.sql
-- Adds a column to track which Zotero group-library item corresponds to a
-- given paper. Set on first successful push by /wids-make-companion (via
-- scripts/zotero_push.py). NULL = not yet pushed.

BEGIN;

ALTER TABLE papers ADD COLUMN zotero_item_key TEXT;

COMMENT ON COLUMN papers.zotero_item_key IS
  'Zotero item key (8-char alphanumeric, e.g. "ABCD1234") for the WiDS NYC '
  'group library (group 6540956). NULL = not yet pushed.';

COMMIT;
