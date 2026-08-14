-- migrations/028_meetings_calendar_event.sql
-- Adds meetings.calendar_event_id and meetings.calendar_html_link so the
-- Google Calendar event backing a meeting is identified by a stored key
-- instead of being re-discovered by a fuzzy title search on every run.
--
-- Why: three consumers currently guess at the event, and they can each guess
-- differently on the same row:
--
--   * calendar-rsvp-sync Step 2 matches on scheduled_at + a `WiDS NYC%` title
--     prefix. Its own text says so: "For V1 we don't store the Calendar event
--     ID separately ... store the event ID on the meeting row in a future
--     schema migration to avoid title matching." This is that migration.
--   * pre-meeting-reminder Step 1b re-runs the same search to gate a send on
--     venue drift. A search that returns nothing is indistinguishable from a
--     genuinely missing event, and the gate holds the reminder either way.
--   * pre-meeting-reminder Step 4a needs a calendar link for the RSVP
--     thank-you. It named `meetings.calendar_ics_url`, a column that has never
--     existed in this schema, so the token had no source at all.
--
-- A title search is fragile in the ways that matter here: the operator renames
-- an event, Google rewrites a venue name, a second `WiDS NYC` event lands in
-- the same date range, or the event is moved and no longer sits in the window
-- the search asks about. Each of those turns into a held reminder or a
-- silently wrong match, and the failure surfaces days later as email nobody
-- received.
--
-- Both columns are nullable and NOT backfilled. No historical row carries an
-- event id, and none can be recovered from the database alone — the id only
-- exists in Google's copy. Consumers therefore must keep the title-search path
-- as a documented fallback for un-backfilled rows rather than treating a NULL
-- as "no event exists". New rows get populated at booking time by
-- /wids-schedule-reading-group and /wids-schedule-admin.
--
--   * calendar_event_id  — the stable Google Calendar event id. Survives
--                          retitling, rescheduling, and venue edits, which is
--                          exactly what the title search does not.
--   * calendar_html_link — the event's `htmlLink`, the operator/member-facing
--                          URL. Stored rather than derived: the eid encoding
--                          is Google's to define, and reconstructing it is a
--                          guess that breaks silently in an email body.
--
-- Verify before applying:
--
--   SELECT count(*) AS already_present FROM information_schema.columns
--   WHERE table_schema='public' AND table_name='meetings'
--     AND column_name IN ('calendar_event_id','calendar_html_link');  -- expected: 0
--
-- Purely additive: two nullable ADD COLUMNs and one partial unique index. No
-- UPDATE, no backfill, no row rewrite, so this needs no multi-row-write
-- confirmation and is safe to re-run.
BEGIN;

ALTER TABLE meetings
  ADD COLUMN IF NOT EXISTS calendar_event_id  TEXT,
  ADD COLUMN IF NOT EXISTS calendar_html_link TEXT;

-- One meeting per Calendar event. Partial so the many un-backfilled NULLs never
-- collide — same shape as command_log_idempotency_key_unique in migration 020.
CREATE UNIQUE INDEX IF NOT EXISTS meetings_calendar_event_id_unique
  ON meetings (calendar_event_id)
  WHERE calendar_event_id IS NOT NULL;

COMMENT ON COLUMN meetings.calendar_event_id IS
  'Google Calendar event id for this meeting, written at booking time by '
  '/wids-schedule-reading-group and /wids-schedule-admin. Stable across '
  'retitling, rescheduling, and venue edits. NULL on rows booked before '
  'migration 028 — consumers fall back to the legacy scheduled_at + '
  '"WiDS NYC%" title search for those, and must not read NULL as "the event '
  'does not exist".';

COMMENT ON COLUMN meetings.calendar_html_link IS
  'The Calendar event htmlLink — the operator/member-facing event URL. Source '
  'for the links.calendar token in the rsvp-confirmation email, replacing the '
  'never-existing meetings.calendar_ics_url the spec used to name. Stored '
  'verbatim from the API rather than derived from calendar_event_id, because '
  'the eid encoding is Google''s to change.';

COMMIT;
