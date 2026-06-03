-- migrations/020_command_log_enrichment.sql
-- Enrich command_log with operability + idempotency columns.
--
-- command_log (created in 001, source CHECK widened in 002) records every
-- slash command, scheduled task, and server action with source/name/status/
-- summary/error. Triage on /admin/logs and idempotency in scheduled tasks have
-- outgrown those seven columns:
--
--   * duration_ms     — how long the run took, for spotting slow/runaway tasks
--                       on the operator triage page. Nullable: not every writer
--                       measures wall-clock.
--   * metadata        — arbitrary structured context (meeting_id, recipient
--                       counts, target ids) so future needs don't each demand a
--                       new migration. NOT NULL DEFAULT '{}' so every row — old
--                       and new — has a well-formed object to read.
--   * idempotency_key — a stable dedupe key (e.g. 'setRsvp:meeting=7:member=3'
--                       or 'availability-chase:meeting=12'). Today scheduled
--                       tasks dedupe with brittle `summary LIKE '%meeting=<id>%'`
--                       scans; a UNIQUE key turns "has this already run?" into a
--                       database invariant — the second write trips 23505 and
--                       the caller treats it as a no-op.
--   * actor           — who/what initiated the run (operator email, cron id),
--                       for attribution in the triage page.
--
-- All four are additive. ADD COLUMN IF NOT EXISTS + a unique INDEX (not a named
-- constraint) keep this migration safe to re-run. UNIQUE on a nullable column
-- permits many NULLs in Postgres, so pre-existing rows and un-keyed writes never
-- collide — only deliberately-keyed runs are deduped.
BEGIN;

ALTER TABLE command_log
  ADD COLUMN IF NOT EXISTS duration_ms     INT,
  ADD COLUMN IF NOT EXISTS metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT,
  ADD COLUMN IF NOT EXISTS actor           TEXT;

-- At-most-once enforcement for keyed runs; NULLs (the default) are exempt.
CREATE UNIQUE INDEX IF NOT EXISTS command_log_idempotency_key_unique
  ON command_log (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

COMMIT;
