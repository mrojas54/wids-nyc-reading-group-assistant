-- migrations/028_meetings_calendar_event.sql
-- Persist the Google Calendar event identity alongside the meeting it books.
--
-- Today nothing in `meetings` records WHICH Calendar event corresponds to the
-- row. Every task that needs the event re-derives it by listing events over a
-- date range and matching a 'WiDS NYC%' title prefix (calendar-rsvp-sync Step 2,
-- pre-meeting-reminder Step 1b). That search is a heuristic: it breaks when a
-- title is edited, when two WiDS events land in the same window, or when the
-- event moves outside the searched range. Two columns fix it at the source:
--
--   * calendar_event_id  — the Calendar event id, written at booking time by
--                          /wids-schedule-reading-group and /wids-schedule-admin.
--                          Turns the venue-freshness gate and the RSVP sync from
--                          "search and hope" into a direct get_event lookup.
--   * calendar_html_link — the event's htmlLink, i.e. the "open in Google
--                          Calendar" URL. This is the source for the
--                          `links.calendar` token in
--                          assets/emails/template/rsvp-confirmation.{html,txt}.
--
-- On `links.calendar`: the pre-meeting-reminder spec previously named a column
-- `meetings.calendar_ics_url`. THAT COLUMN HAS NEVER EXISTED in this schema, so
-- the required token had no source and the templated RSVP thank-you could not be
-- rendered without a broken link. `calendar_html_link` is that missing source.
--
-- Both are nullable and additive. Pre-existing rows stay NULL and are NOT
-- backfillable — the mapping was never recorded, so there is nothing to recover.
-- Callers must keep the title-search fallback for NULL rows, and
-- pre-meeting-reminder must downgrade a recipient to the plain reminder rather
-- than render the thank-you template with an unresolved link.
--
-- ┌─ CAUTION: interaction with migration 026's updated_at trigger ─────────────┐
-- │ `meetings_set_updated_at` fires on any UPDATE where OLD.* IS DISTINCT FROM │
-- │ NEW.*, so writing these columns in a SEPARATE UPDATE after booking will    │
-- │ advance meetings.updated_at. That timestamp is the tiebreaker deciding     │
-- │ which side of a Calendar-vs-database venue disagreement was written last   │
-- │ (docs/venue-drift.md), so a post-hoc write makes the database look newer   │
-- │ than it is and can turn a plain `material` drift into `material_db_newer`. │
-- │ Write calendar_event_id/calendar_html_link in the SAME statement that      │
-- │ writes location and scheduled_at at booking time — not as a follow-up.     │
-- └───────────────────────────────────────────────────────────────────────────┘
--
-- The lookup index is deliberately NOT unique. One event maps to one meeting in
-- normal operation, but a cancelled-then-rebooked meeting can legitimately leave
-- a stale id on the cancelled row, and a unique index would block the rebooking
-- at the worst possible moment. Uniqueness here would be an invariant we cannot
-- honestly promise; the index exists for lookup speed only.
--
-- No RLS change: `meetings` is an existing table, so the ensure_rls event trigger
-- does not fire and its policies are untouched. Note that `authenticated` holds a
-- table-level SELECT on `meetings`, and Postgres extends a table-level grant to
-- new columns automatically — so both columns become readable by signed-in portal
-- sessions, subject to the existing row policies. That is intended: the htmlLink
-- is the same URL members receive in their invite.
--
-- ADD COLUMN IF NOT EXISTS + CREATE INDEX IF NOT EXISTS make this safe to re-run.
-- Additive and nullable: no backfill, no multi-row UPDATE, so no operator
-- confirmation is required under CLAUDE.md.
--
-- Regenerate web/lib/database.types.ts after applying.
BEGIN;

ALTER TABLE meetings
  ADD COLUMN IF NOT EXISTS calendar_event_id  TEXT,
  ADD COLUMN IF NOT EXISTS calendar_html_link TEXT;

COMMENT ON COLUMN meetings.calendar_event_id IS
  'Google Calendar event id for this meeting, written at booking time. NULL on '
  'rows created before migration 028 (not backfillable) — callers must fall back '
  'to the list_events date-range + ''WiDS NYC%'' title search. Write it in the '
  'same UPDATE as location/scheduled_at: a separate write advances updated_at '
  'and skews the venue-drift tiebreaker (see migration 026 and docs/venue-drift.md).';

COMMENT ON COLUMN meetings.calendar_html_link IS
  'Google Calendar event htmlLink ("open in Google Calendar" URL). Source for the '
  'links.calendar token in assets/emails/template/rsvp-confirmation.{html,txt}; '
  'replaces the never-existent meetings.calendar_ics_url named by earlier specs. '
  'NULL on pre-028 rows — pre-meeting-reminder must downgrade those recipients to '
  'the plain reminder rather than render a template with a broken link.';

-- Lookup path for calendar-rsvp-sync and the pre-meeting-reminder venue gate.
-- Partial: only booked rows carry an id, and NULLs are the common pre-028 case.
CREATE INDEX IF NOT EXISTS meetings_calendar_event_id_idx
  ON meetings (calendar_event_id)
  WHERE calendar_event_id IS NOT NULL;

COMMIT;
