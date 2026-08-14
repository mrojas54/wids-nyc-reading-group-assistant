-- migrations/029_command_log_needs_action.sql
-- Widen command_log.status to admit 'needs_action'.
--
-- `status` has carried three values since migration 001: 'success', 'failure',
-- 'no_action'. That vocabulary has no way to say the one thing several tasks
-- actually mean:
--
--     the run did its own work correctly, and a human must now act
--     for the outcome to be real.
--
-- The concrete case is pre-meeting-reminder. Nothing in this repo may send email
-- as the operator, so member-facing mail is always DRAFTED for a human to press
-- send. A run that renders and drafts eight reminders has succeeded at its job,
-- but the members have not been reminded until the operator opens Gmail. Every
-- available status misreports that state:
--
--   * 'success'   — renders info/green on /admin/logs. A run holding eight
--                   UNSENT drafts looks identical to a clean one. This is how
--                   meeting 37 (2026-08-11) went out with nobody reminded.
--   * 'failure'   — untrue, and worse than untrue: the run worked. Reserve it
--                   for real errors (venue hold, create_draft error, unresolved
--                   token) so failure keeps meaning failure.
--   * 'no_action' — goes amber, but is false (drafts WERE created) and collides
--                   with the genuine nothing-to-do case, which the same task
--                   logs when no meeting falls in the window.
--
-- 'needs_action' names the state directly and derives to WARN, so pending drafts
-- render amber and the status header counts them. Paired with the filterable
-- metadata.operator_action_required flag, the operator can list everything
-- waiting on them without opening Gmail.
--
-- ┌─ THIS MIGRATION IS NOT SUFFICIENT ON ITS OWN ─────────────────────────────┐
-- │ web/lib/logs.ts must change in the same breath, or applying this makes    │
-- │ things quietly worse rather than better:                                  │
-- │                                                                           │
-- │   * `LogStatus` (line 26) does not include 'needs_action', so the row is  │
-- │     outside the declared type the /admin/logs reader expects.             │
-- │   * `deriveSeverity` (line 93) tests 'failure' then 'no_action' and falls │
-- │     through to `return "info"`. An unmapped 'needs_action' row therefore  │
-- │     renders INFO/GREEN — the exact failure mode described above, now with │
-- │     a status string that claims otherwise.                                │
-- │   * LogsTable.tsx's status pill and logs.css's `.statuspill.no_action`    │
-- │     rule have no 'needs_action' counterpart, so the pill renders unstyled.│
-- │                                                                           │
-- │ Apply this migration only together with those changes (and the matching   │
-- │ case in web/lib/__tests__/logs.test.ts). Until then, a task needing this  │
-- │ status should keep logging 'success' and say plainly in its summary that  │
-- │ the drafts are unsent.                                                    │
-- └───────────────────────────────────────────────────────────────────────────┘
--
-- Mechanics: widening a CHECK is safe by construction — the new predicate admits
-- a strict superset of the old one, so no existing row can violate it and the
-- validation scan cannot fail. command_log is small and append-only; the scan is
-- cheap and NOT VALID is unnecessary. DROP CONSTRAINT IF EXISTS + ADD CONSTRAINT
-- keeps this re-runnable. The constraint keeps its original name
-- (`command_log_status_check`, confirmed against the live project) so anything
-- matching on that name still finds it.
--
-- Nothing is written or deleted here; no operator confirmation is required under
-- CLAUDE.md. Regenerate web/lib/database.types.ts after applying.
BEGIN;

ALTER TABLE command_log
  DROP CONSTRAINT IF EXISTS command_log_status_check;

ALTER TABLE command_log
  ADD CONSTRAINT command_log_status_check
  CHECK (status = ANY (ARRAY['success', 'failure', 'no_action', 'needs_action']));

COMMENT ON COLUMN command_log.status IS
  'Run outcome. success = worked, nothing pending. failure = real error. '
  'no_action = there was genuinely nothing to do. needs_action = the run did its '
  'own work correctly but a human must act for the outcome to be real (e.g. a '
  'drafted email nobody has sent yet); derives to WARN on /admin/logs and is '
  'normally paired with metadata.operator_action_required = true.';

COMMIT;
