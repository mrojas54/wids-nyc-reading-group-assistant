-- migrations/025_members_vouched_by_comment.sql
-- Re-apply the members.vouched_by column comment so the database matches the
-- repository.
--
-- Why this exists: the COMMENT text inside 023_members_vouched_by.sql was
-- edited in place on 2026-07-31 (dc5ec0f), after 023 had already been applied.
-- The correction itself is right — the token is `vouch.firstName`, not
-- `{{ vouch.name }}`, and `Blocks(vouch=False)` drops only the vouch card while
-- the intro, preheader, and footer still require the name. But because these
-- migrations are hand-applied with no tracking table (see migrations/README.md),
-- editing a landed file changes the repo without changing any database that
-- already ran it. Anyone inspecting the live schema with `\d+ members` still
-- sees the superseded `{{ vouch.name }}` wording.
--
-- This migration carries that same corrected text forward so file and database
-- converge. It is the only statement here: no DDL, no data change.
--
-- COMMENT ON COLUMN is idempotent — it overwrites whatever is there — so this
-- is safe to run against a database that already has the new text, and safe to
-- re-run.
--
-- Numbering note: 024 is intentionally skipped. It is claimed by in-flight work
-- (024_drop_packets_sent_at.sql) that had not landed on main when this was
-- written. Filenames define order only and there is no tracking table, so a gap
-- is harmless; a duplicate number would not be.

BEGIN;

COMMENT ON COLUMN members.vouched_by IS
  'The existing member who vouched this person in. Self-referencing FK, '
  'nullable: NULL means unknown or not applicable (all rows predating '
  'migration 023, plus operator-added members with no voucher). Source for '
  'the vouch.firstName token in welcome-availability (caller takes the first '
  'name). Blocks(vouch=False) drops only the vouch card; the intro, preheader, '
  'and footer still need vouch.firstName unless no-voucher copy is written.';

COMMIT;
