---
schedule: daily
description: Pull RSVP state, rescheduling, and venue drift from Calendar events into meetings
---

# scheduled_tasks/calendar-rsvp-sync

Runs daily. Reflects Calendar truth into Supabase.

Three things drift between a Calendar event and its `meetings` row: attendee
RSVPs (Step 3), the start time (Step 4a), and the venue (Step 4b). The first
two are written automatically. The third is usually not — see
[`docs/venue-drift.md`](../docs/venue-drift.md) for why, and for the worked
example behind the rule.

## Step 1 — Find scheduled meetings

```sql
SELECT id, type, scheduled_at, location, updated_at, calendar_event_id
FROM meetings
WHERE status='scheduled' AND scheduled_at > now() - interval '1 day';
```

`updated_at` arrives with migration 026 and `calendar_event_id` with migration
028. If either column does not exist yet the query errors — drop it from the
select list and treat its value as unavailable everywhere below (Step 4b says
what changes when `updated_at` is missing; Step 2 says what changes when
`calendar_event_id` is).

## Step 2 — For each meeting, find Calendar event

**Preferred — stored id.** If `calendar_event_id IS NOT NULL`, fetch that event
directly by id. This is exact: it survives the operator retitling the event,
moving it to another date, or editing the venue, none of which the fallback
below survives. `/wids-schedule-reading-group` and `/wids-schedule-admin` write
the column at booking time.

If the stored id returns 404/not-found, the event was deleted or the id is
stale. Do **not** silently fall back to the title search — a stored id that no
longer resolves is a real inconsistency, not a lookup miss. Treat it as
`event_not_found` for this meeting and leave `calendar_event_id` in place for
the operator to inspect.

**Fallback — title search (pre-028 rows only).** If `calendar_event_id IS NULL`,
look up by `scheduled_at` date range + event title prefix `WiDS NYC%` via
Calendar MCP `list_events`, exactly as before. Migration 028 is not backfillable
— an event id exists only in Google's copy — so NULL means "booked before 028",
not "no event exists".

When the fallback resolves to exactly one event, write the id back so the next
run takes the preferred path:

```sql
UPDATE meetings
SET calendar_event_id = '<event_id>', calendar_html_link = '<event_htmlLink>'
WHERE id = <id> AND calendar_event_id IS NULL;
```

If the fallback matches more than one event, that ambiguity is the reason the
stored id exists. Do not guess — treat it as `event_not_found` and move on.

Capture from the matched event: `id`, `htmlLink`, `start`, `location`,
`updated`, and the attendee list. `location` and `updated` are what Step 4b
needs.

## Step 3 — Sync attendance

For each event:
- For each attendee (member email match):
  - Map their `responseStatus` (`accepted` | `declined` | `tentative` | `needsAction`) to our enum (`attending` | `declined` | `tentative` | `no_response`).
  - Capture the Calendar response timestamp (`<calendar_response_at>`) — Google Calendar exposes this on the attendee record; if unavailable, fall back to event `updated`.
  - UPSERT `meeting_attendance` with the **last-write-wins tiebreaker** below.

**Tiebreaker rule (added with migration 002):** Only overwrite `rsvp_status` if the calendar event's response timestamp is **strictly later than** `meeting_attendance.responded_at`. If `responded_at IS NULL`, the calendar value always wins. This preserves portal RSVPs from being clobbered by stale calendar data.

```sql
INSERT INTO meeting_attendance (meeting_id, member_id, rsvp_status, responded_at)
VALUES (<meeting_id>, <member_id>, '<mapped_status>', <calendar_response_at>)
ON CONFLICT (meeting_id, member_id) DO UPDATE
  SET rsvp_status = EXCLUDED.rsvp_status,
      responded_at = EXCLUDED.responded_at
  WHERE meeting_attendance.responded_at IS NULL
     OR meeting_attendance.responded_at < EXCLUDED.responded_at;
```

## Step 4a — Sync rescheduling

If the Calendar event's start time differs from `meetings.scheduled_at`:
```sql
UPDATE meetings SET scheduled_at = <event_start>
WHERE id = <meeting_id>;
```

One row by construction (`WHERE id = …`). Count each applied reschedule for
`reschedules_detected` in Step 5.

## Step 4b — Sync venue

Compare the event's `location` against `meetings.location`. A literal
comparison is useless here: both sides start as the same operator-typed string,
but Google rewrites its copy into a place record the moment the venue is edited
in the Calendar UI — `Prince Tea House - Ktown, 324 5th Ave, New York, NY
10001` becomes `Prince Tea House Ktown | Dessert Spot at Fifth Ave, 324 5th
Ave, New York, NY 10001, USA`. Same venue, four cosmetic differences.

### Classify

Do not normalize the strings by hand — call `scripts/venue_keys.py`, which
`pre-meeting-reminder` Step 1b also calls. The two tasks must reach the same
verdict on the same pair of strings; a venue this task calls in-sync and that
one calls drift would hold every reminder forever.

```python
from scripts.venue_keys import classify, drift_slug

result = classify(
    db_location,              # meetings.location, may be None
    calendar_location,        # event.location, may be None
    meeting_updated_at=...,   # from Step 1; None until migration 026
    event_updated=...,        # the Calendar event's `updated` field
)
```

`classify` splits each string into a **name key** (field 0 up to the first `|`,
lowercased, punctuation dropped) and an **address key** (the remaining
comma-separated fields, minus a trailing `USA`, with street suffixes
canonicalized so `Avenue` and `Ave` land together). Both examples above reduce
to name key `prince tea house ktown` and address key
`324 5th ave new york ny 10001` — in sync.

The address key decides. The name key only separates "same place, spelled
differently" from "same place, agreed" — it never escalates on its own.

| `result.classification` | when | action |
|---|---|---|
| `no_location` | neither side has a venue | nothing |
| `backfill` | database empty, Calendar has one | write (below) |
| `calendar_missing` | Calendar empty, database has one | never blank the DB; count it, no alert |
| `in_sync` | both keys agree | nothing |
| `cosmetic` | same address, different name spelling | no write, no alert, count it |
| `material` | addresses differ | hold the write, alert (below) |
| `material_db_newer` | addresses differ, but `meetings.updated_at > event.updated` | hold the write, **no alert**, count it |

`result.writable` is true only for `backfill`; `result.alertable` only for
`material`. Trust those flags rather than re-deriving the policy here.

Two behaviors worth knowing, both covered by `tests/venue_keys_test.py`:

- A bare venue name with no street address yields an empty address key. The
  comparison falls back to the whole normalized string and escalates any
  difference to `material` — fail toward surfacing.
- The `material_db_newer` downgrade needs *both* timestamps and fires only in
  the strong direction. Google bumps `event.updated` on any event change, an
  attendee RSVP included, so a newer event never authorizes a write. Before
  migration 026 `meeting_updated_at` is None and nothing is ever downgraded.

### `backfill` — the only automatic venue write

`location IS NULL` on a scheduled meeting means the reminder renders "at "
regardless, so there is nothing to clobber and any real value is an
improvement. Write `result.suggested_location` — Google's string with the `|`
tagline and the trailing country removed, original casing kept:
`Prince Tea House Ktown, 324 5th Ave, New York, NY 10001`.

Dollar-quote every interpolated text value (`$wids$…$wids$`), never
single quotes. Venue strings contain apostrophes (`Jack's Wife Freda` —
the 2026-08-10 incident). If a value itself contains `$wids$`, pick
another tag. `<meeting_id>` is an integer and stays unquoted.

```sql
UPDATE meetings
SET location = $wids$<result.suggested_location>$wids$
WHERE id = <meeting_id> AND location IS NULL;
```

One row by construction. The `AND location IS NULL` guard makes it safe against
a concurrent write: `UPDATE 0` means someone else set a venue between Step 1
and here — treat that as a no-op, do not retry, and reclassify the meeting on
the next run. Record `house_style: false` in metadata: the tidied string is not
the `<Name> - <Neighborhood>, …` convention, because the neighborhood is not
derivable from Google's string.

### `material` — hold the write, alert the operator

Do **not** write. The correct value is not derivable (see
[`docs/venue-drift.md`](../docs/venue-drift.md)), the database is sometimes the
right side, and `CLAUDE.md` exists because an agent once rewrote member-facing
data on a contextual signal.

`material_db_newer` skips this whole section — no log row, no email, just the
`venue_drift_db_newer` counter in Step 5. The database won that race, so there
is nothing to tell the operator. `pre-meeting-reminder` Step 1b still holds the
send, which is the backstop for having stayed quiet here.

Log the drift with an idempotency key, so an unresolved drift alerts once
rather than daily:

```sql
INSERT INTO command_log (source, name, status, summary, idempotency_key, metadata)
VALUES ('scheduled_task', 'calendar-rsvp-sync', 'no_action',
        format(
          'meeting=%s: venue drift held for operator — DB %s vs Calendar %s',
          <id>,
          $wids$<db_location>$wids$,
          $wids$<calendar_location>$wids$
        ),
        format(
          'calendar-rsvp-sync:venue-drift:meeting=%s:%s',
          <id>,
          $wids$<drift_slug(result)>$wids$
        ),
        jsonb_build_object(
          'event',                'venue_drift',
          'classification',       'material',
          'meeting_id',           <id>,
          'calendar_event_id',    $wids$<event_id>$wids$,
          'db_location',          $wids$<db_location>$wids$,
          'calendar_location',    $wids$<calendar_location>$wids$,
          'suggested_location',   $wids$<result.suggested_location>$wids$,
          'db_address_key',       $wids$<result.db_address_key>$wids$,
          'calendar_address_key', $wids$<result.calendar_address_key>$wids$,
          'auto_write_withheld',  true,
          'resolution_required',  true,
          'event_updated',        $wids$<event.updated>$wids$,
          'meeting_updated_at',   $wids$<meeting_updated_at or null>$wids$
        ));
```

A unique violation (SQLSTATE 23505) on `command_log_idempotency_key_unique`
means this exact calendar value was already flagged for this meeting: skip the
insert **and** skip the email, and count it as `venue_drift_repeat` in Step 5.
`status='no_action'` is deliberate — `/admin/logs` derives severity from
status and renders `no_action` as a warning, which is what an unresolved drift
should look like. Do not invent a new status value; the `command_log.status`
CHECK admits only `success`, `failure`, `no_action`.

Then email the operator (`SELECT email, name FROM members WHERE role='operator'`):

Subject: `WiDS NYC: venue mismatch on meeting <id> — needs your call`

```
Hi <operator_name>,

The Google Calendar event and the database disagree about where meeting <id>
(<scheduled_at>, <paper_title or 'admin meeting'>) is happening. I have not
changed anything.

  Database:  <db_location>
  Calendar:  <calendar_location>

The calendar invite is what the <N> attendees are holding.

If the Calendar is right, run this — I've tidied Google's string, but the
"<Name> - <Neighborhood>" house style needs your eye, so edit before running:

  UPDATE meetings
  SET location = $wids$<result.suggested_location>$wids$
  WHERE id = <id>;
  -- expect: UPDATE 1

If the database is right, edit the Location on the Calendar event instead and
leave the row alone — the attendees will see the correction in their invite.

Until this is resolved the pre-meeting reminder for meeting <id> will not
send; it re-checks the venue against Calendar right before building the
recipient list.
```

## Step 5 — Log

One row per run, summarizing everything. This is separate from the keyed
`venue_drift` rows written in Step 4b.

```sql
INSERT INTO command_log (source, name, status, summary, metadata)
VALUES ('scheduled_task', 'calendar-rsvp-sync', 'success',
        'Synced <N> RSVPs across <M> meetings; <R> reschedules, <V> venue drifts held',
        jsonb_build_object(
          'rsvps_synced',             <N>,
          'meetings_touched',         <M>,
          'reschedules_detected',     <R>,
          'venue_checked',            <count of meetings compared>,
          'venue_in_sync',            <count>,
          'venue_cosmetic',           <count>,
          'venue_backfilled',         <count>,
          'venue_calendar_missing',   <count>,
          'venue_drift_material',     <count alerted this run>,
          'venue_drift_db_newer',     <count suppressed by the 026 tiebreaker>,
          'venue_drift_repeat',       <count already flagged, 23505>,
          'venue_drift_meeting_ids',  <int array of material + db_newer meeting ids>
        ));
```

Keep these key names exactly as written. Earlier runs spelled the RSVP
timestamp source three different ways (`response_timestamp_source`,
`responded_at_source`, `response_ts_source`), which makes the metadata
unqueryable across runs — don't add a fourth spelling for venues.

If nothing at all changed, log `status='no_action'` with the same metadata.

## Triage

What has been flagged, historically:

```sql
SELECT ran_at, summary, metadata
FROM command_log
WHERE name IN ('calendar-rsvp-sync', 'pre-meeting-reminder')
  AND metadata->>'event' = 'venue_drift'
ORDER BY ran_at DESC;
```

A row here does **not** mean the drift is still open. There is no drift queue
by design — the comparison is recomputed from Calendar plus the database on
every run, so a resolved drift simply stops appearing. See
[`docs/venue-drift.md`](../docs/venue-drift.md).
