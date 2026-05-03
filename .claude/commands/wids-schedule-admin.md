---
description: Pick admin meeting date from collected availability, confirm with operator, book Calendar event
---

# /wids-schedule-admin

Two-phase: compute → present → confirm → book.

## Step 1 — Find the admin meeting

```sql
SELECT id FROM meetings
WHERE type='admin' AND status='prep' AND form_url IS NOT NULL
ORDER BY created_at DESC LIMIT 1;
```

If no row, halt: "No admin meeting in prep with a form_url. Run `/wids-meeting-start admin` first."

## Step 2 — Compute the best window

Read availability rows:
```sql
SELECT a.member_id, a.range_start, a.range_end
FROM availability a
WHERE a.meeting_id = <admin_id>;
```

Compute the highest-overlap window. For each pair (range_start, range_end) appearing in the data, treat it as a candidate fixed slot of `range_start + 90 minutes` (default admin meeting duration). For each candidate slot, count how many distinct member_ids have availability fully covering it. Rank by count descending, then by earliness ascending.

In SQL (single query):
```sql
WITH slots AS (
  SELECT DISTINCT range_start AS slot_start,
                  range_start + interval '90 minutes' AS slot_end
  FROM availability WHERE meeting_id = <admin_id>
),
overlaps AS (
  SELECT s.slot_start, s.slot_end,
         count(DISTINCT a.member_id) AS members_available
  FROM slots s
  LEFT JOIN availability a
    ON a.meeting_id = <admin_id>
   AND a.range_start <= s.slot_start
   AND a.range_end   >= s.slot_end
  GROUP BY s.slot_start, s.slot_end
)
SELECT slot_start, slot_end, members_available
FROM overlaps
ORDER BY members_available DESC, slot_start ASC
LIMIT 5;
```

## Step 3 — Present to operator

Show top window + total active members:
```sql
SELECT count(*) FROM members WHERE active=true;
```

Format:
```
Best window for admin meeting:
  <slot_start> to <slot_end> ET
  <members_available>/<total> active members can attend

Members who can't make it:
  <names of members WITHOUT covering availability>

Reply:
  'go'   to book this slot
  'next' to see the runner-up window
  'skip' to abort
```

If 'next', advance through ranked list.

## Step 4 — On 'go': create Calendar event

Use Calendar MCP to create event:
- Title: "WiDS NYC Reading Group — Admin Meeting"
- Description: "Planning for the next reading group. Form URL: <form_url>"
- Start: slot_start, End: slot_end
- Conferencing: Google Meet (auto-generated)
- Attendees: all active members' emails
- Send invitations: yes

Capture the event ID and Meet link.

## Step 5 — Update DB

```sql
UPDATE meetings
SET scheduled_at = <slot_start>,
    location = 'Online (Meet link in calendar invite)',
    status = 'scheduled'
WHERE id = <admin_id>;

INSERT INTO meeting_attendance (meeting_id, member_id, rsvp_status)
SELECT <admin_id>, id, 'no_response' FROM members WHERE active=true
ON CONFLICT (meeting_id, member_id) DO NOTHING;
```

## Step 6 — Audit log

```sql
INSERT INTO command_log (source, name, status, summary)
VALUES ('slash_command', '/wids-schedule-admin', 'success',
        'Scheduled admin <admin_id> at <slot_start>; <members_available>/<total> attending');
```

## Failure handling

- No availability rows → halt: "No availability collected yet. The `process-form` scheduled task ingests responses daily — make sure the operator has uploaded the responses CSV to `<drive_root>/cycles/<cycle_label>/admin-form-responses.csv`."
- Calendar event creation fails → no DB update; log failure with the error message.
