---
schedule: daily
description: Detect low availability-response rates and email operator (operator-first, no auto-send to members)
---

# scheduled_tasks/availability-chase

Runs daily. For any meeting in `status='prep'` more than 7 days old, computes availability-response rate; if low, alerts the operator. Renamed from `form-response-chase` with migration 002 — availability is now collected via the portal at `https://wids-nyc-reading-group-assistant.vercel.app/availability`, not Google Forms.

## Step 1 — Find prep meetings needing chase

```sql
SELECT m.id, m.type, m.created_at,
       (SELECT count(DISTINCT a.member_id) FROM availability a WHERE a.meeting_id = m.id) AS responded,
       (SELECT count(*) FROM members WHERE active=true) AS total
FROM meetings m
WHERE m.status='prep'
  AND m.created_at < now() - interval '7 days';
```

## Step 2 — For each row, decide

For each meeting:
- response_rate = responded / total
- If response_rate < 0.5 AND last alert email for this meeting was sent >5 days ago (or never):
  - Send alert. (Step 3.)
- Otherwise: skip.

(Idempotency: query `command_log` for prior alerts on this meeting:)
```sql
SELECT MAX(ran_at) FROM command_log
WHERE name='availability-chase' AND status='success' AND summary LIKE '%meeting=<id>%';
```

## Step 3 — Send alert email

Recipient: operator.

Subject: `WiDS NYC: availability for <meeting_type> meeting at <responded>/<total> responses`

Body:
```
The portal availability page for <meeting_type> meeting #<id> has been open <days> days.
Response rate: <responded>/<total> active members.

Non-responders:
  <names of active members WITHOUT availability rows for this meeting>

Portal link: https://wids-nyc-reading-group-assistant.vercel.app/availability

Reply:
  'remind'  — I'll email non-responders directly with the portal link
  'wait'    — leave as-is for now

If you reply 'remind', I'll send a brief reminder to non-responders only.
```

## Step 4 — Log

```sql
INSERT INTO command_log (source, name, status, summary)
VALUES ('scheduled_task', 'availability-chase', 'success',
        'Sent low-response alert to operator for meeting=<id>: <responded>/<total>');
```
