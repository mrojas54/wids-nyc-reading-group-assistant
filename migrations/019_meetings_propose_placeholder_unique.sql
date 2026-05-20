-- migrations/019_meetings_propose_placeholder_unique.sql
-- Concurrency guard for the PaperPal proposePaper server action.
--
-- proposePaper (web/lib/paperpal/inbox-actions.ts) creates a placeholder
-- prep reading_group meeting to hang a member's paper_suggestions row off.
-- Without a database constraint, two concurrent proposes of the same paper
-- both find no existing placeholder and each mint one — and paper_suggestions'
-- UNIQUE(meeting_id, paper_id) cannot catch it, because the two suggestions
-- land on different meeting_ids. The result is duplicate placeholder meetings
-- for one paper, with no error raised.
--
-- This partial unique index makes "at most one member-proposed placeholder
-- per paper" a database invariant: the losing concurrent insert trips 23505
-- and the action reuses the winner instead of minting a duplicate.
--
-- Scope — planned_by_admin_id IS NULL: a cycle's canonical reading_group
-- meeting (created by /wids-meeting-start) always has planned_by_admin_id
-- set, and /wids-find-paper later sets that meeting's paper_id while it is
-- still in prep status. Restricting the index to planned_by_admin_id IS NULL
-- keeps it from colliding with that operator cycle flow — it constrains only
-- proposePaper's placeholders, which never set planned_by_admin_id.
--
-- Pre-existing placeholders created before this migration have paper_id NULL
-- (the prior proposePaper did not set it); NULLs are exempt from a unique
-- index, so index creation cannot fail on existing data and those rows are
-- simply left as-is.
BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS meetings_propose_placeholder_paper_unique
  ON meetings (paper_id)
  WHERE type = 'reading_group'
    AND status = 'prep'
    AND planned_by_admin_id IS NULL;

COMMIT;
