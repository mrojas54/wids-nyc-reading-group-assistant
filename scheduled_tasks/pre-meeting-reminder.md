---
schedule: daily
description: Email logistics reminder to active members 2 days before any scheduled meeting
---

# scheduled_tasks/pre-meeting-reminder

Runs daily. For any meeting `status='scheduled'` with `scheduled_at` 2 days out, emails active members the logistics.

## Step 1 — Find meetings 2 days out

```sql
SELECT m.id, m.type, m.scheduled_at, m.location, m.paper_id,
       p.title AS paper_title,
       leader.name AS leader_name
FROM meetings m
LEFT JOIN papers p ON p.id = m.paper_id
LEFT JOIN members leader ON leader.id = m.leader_id
WHERE m.status='scheduled'
  AND m.scheduled_at >= now() + interval '2 days'
  AND m.scheduled_at <  now() + interval '3 days';
```

## Step 2 — Check idempotency

For each meeting, check if reminder already sent:
```sql
SELECT count(*) FROM command_log
WHERE name='pre-meeting-reminder'
  AND summary LIKE '%meeting=<id>%'
  AND status='success';
```
If > 0, skip.

## Step 3 — Build recipient list (only no_response RSVPs)

```sql
SELECT mem.email, mem.name
FROM meeting_attendance ma
JOIN members mem ON mem.id = ma.member_id
WHERE ma.meeting_id = <id> AND ma.rsvp_status='no_response' AND mem.active=true;
```

(Members who already RSVP'd attending/declined/tentative don't need a reminder; they have their answer.)

## Step 4 — Compose and send

For admin meeting:
```
Subject: Reminder — WiDS NYC admin meeting <when>

Hi <name>,

Just a heads-up that the admin meeting is on <scheduled_at>. Meet link is in
the calendar invite. We'll pick the next leader and confirm the next paper.

If you can't make it, decline the calendar invite so we know.
```

For reading_group meeting:
```
Subject: Reminder — WiDS NYC reading group <when> at <location>

Hi <name>,

Reminder: we're meeting <scheduled_at> at <location> to discuss
"<paper_title>" (led by <leader_name>).

If you haven't received the discussion guide yet, ask <leader_name>.
```

Send via Gmail MCP.

## Step 5 — Log

```sql
INSERT INTO command_log (source, name, status, summary)
VALUES ('scheduled_task', 'pre-meeting-reminder', 'success',
        'Reminded N members for meeting=<id>');
```
