-- migrations/029_command_log_needs_action_status.sql
-- Widens the command_log.status CHECK to add 'needs_action', so a run that
-- finished its own work but left something for a human is distinguishable from
-- a run that is genuinely done.
--
-- Why: the three existing statuses cannot express "succeeded, and now a person
-- must act". /admin/logs derives severity from status — failure→error,
-- no_action→warn, success→info (web/lib/logs.ts:93) — so the only honest
-- choices for a task that drafts email were both wrong:
--
--   * 'success'   → renders info/green. A run that left 8 unsent drafts looks
--                   identical to a clean one, which is exactly how the
--                   2026-08-11 pre-meeting-reminder run for meeting 37 went
--                   unnoticed until the meeting was 2 days away and 8 members
--                   had never been reminded. See scheduled_tasks/
--                   pre-meeting-reminder.md.
--   * 'no_action' → renders warn, but is a lie: drafts WERE created. It also
--                   collides with the real no-op case, so "nothing to do today"
--                   and "someone must press send" become indistinguishable in
--                   the one view an operator actually checks.
--
-- 'needs_action' means: the task completed successfully AND a human must do
-- something before the outcome is real. It maps to warn, alongside no_action —
-- amber is the correct colour for both "I did nothing" and "I did my part";
-- neither is an error, and neither should read as all-clear.
--
-- The Gmail MCP has no send tool (create_draft/update_draft only), so every
-- member-facing scheduled task in this repo terminates in a draft a human sends.
-- That is a standing condition, not an incident, and it needs a standing status.
--
-- Verify before applying:
--
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint
--   WHERE conname = 'command_log_status_check';
--   -- expected before: CHECK (status = ANY (ARRAY['success','failure','no_action']))
--
--   SELECT status, count(*) FROM command_log GROUP BY status ORDER BY 2 DESC;
--   -- every existing value must be one of the three; this migration only ADDS
--   -- a fourth, so no existing row can be invalidated.
--
-- Widening a CHECK never invalidates existing rows, so there is no data
-- migration and no row is rewritten. Postgres does take a brief ACCESS
-- EXCLUSIVE lock and re-validates the table on ADD CONSTRAINT; command_log is
-- small and service-role-only, so this is not an availability concern here.
--
-- DROP IF EXISTS + ADD keeps the migration re-runnable. Both statements are in
-- one transaction, so a failure leaves the original constraint in place.
BEGIN;

ALTER TABLE command_log DROP CONSTRAINT IF EXISTS command_log_status_check;

ALTER TABLE command_log ADD CONSTRAINT command_log_status_check
  CHECK (status IN ('success', 'failure', 'no_action', 'needs_action'));

COMMENT ON COLUMN command_log.status IS
  'Run outcome. success = done, nothing owed. failure = the run errored. '
  'no_action = there was nothing to do. needs_action = the run did its own '
  'work and a human must now act for the outcome to be real (added in '
  'migration 029; the canonical case is a scheduled task that can only create '
  'a Gmail draft, because the Gmail MCP exposes no send tool). /admin/logs '
  'derives severity from this column: failure -> error, no_action and '
  'needs_action -> warn, success -> info.';

COMMIT;
