---
schedule: daily
description: Pull RSVP state and rescheduling from Calendar events into meeting_attendance
---

# scheduled_tasks/calendar-rsvp-sync

Runs daily. Reflects Calendar truth into Supabase.

## Step 1 — Find scheduled meetings

```sql
SELECT id, scheduled_at FROM meetings
WHERE status='scheduled' AND scheduled_at > now() - interval '1 day';
```

## Step 2 — For each meeting, find Calendar event

For V1 we don't store the Calendar event ID separately — we look up by scheduled_at + event title pattern (`WiDS NYC%`).

If your scheduled-tasks runtime supports it, store the event ID on the meeting row in a future schema migration to avoid title matching.

Use Calendar MCP `list_events` filtered by date range and title prefix to find the matching event.

## Step 3 — Sync attendance

For each event:
- For each attendee (member email match):
  - Map their `responseStatus` (`accepted` | `declined` | `tentative` | `needsAction`) to our enum (`attending` | `declined` | `tentative` | `no_response`).
  - UPDATE `meeting_attendance` for that (meeting_id, member_id) pair, also setting `responded_at = now()` if status changed from `no_response`.

```sql
UPDATE meeting_attendance
SET rsvp_status = '<mapped_status>',
    responded_at = COALESCE(responded_at, now())
WHERE meeting_id = <meeting_id> AND member_id = <member_id>
  AND rsvp_status != '<mapped_status>';
```

## Step 4 — Sync rescheduling

If the Calendar event's start time differs from `meetings.scheduled_at`:
```sql
UPDATE meetings SET scheduled_at = <event_start>
WHERE id = <meeting_id>;
```

## Step 5 — Log

```sql
INSERT INTO command_log (source, name, status, summary)
VALUES ('scheduled_task', 'calendar-rsvp-sync', 'success',
        'Synced N RSVPs across M meetings');
```
