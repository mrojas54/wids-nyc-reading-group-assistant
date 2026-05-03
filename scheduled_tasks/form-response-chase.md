---
schedule: daily
description: Detect low-response forms and email operator (operator-first, no auto-send to members)
---

# scheduled_tasks/form-response-chase

Runs daily. For any meeting in `status='prep'` with a form_url, computes response rate; if low, alerts the operator.

## Step 1 — Find prep meetings with forms

```sql
SELECT m.id, m.type, m.form_url, m.created_at,
       (SELECT count(DISTINCT a.member_id) FROM availability a WHERE a.meeting_id = m.id) AS responded,
       (SELECT count(*) FROM members WHERE active=true) AS total
FROM meetings m
WHERE m.status='prep'
  AND m.form_url IS NOT NULL
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
WHERE name='form-response-chase' AND status='success' AND summary LIKE '%meeting=<id>%';
```

## Step 3 — Send alert email

Recipient: operator.

Subject: `WiDS NYC: form for <meeting_type> meeting at <responded>/<total> responses`

Body:
```
The form for <meeting_type> meeting #<id> has been out <days> days.
Response rate: <responded>/<total> active members.

Non-responders:
  <names of active members WITHOUT availability rows for this meeting>

Form URL: <form_url>

Reply:
  'remind'  — I'll email non-responders directly
  'wait'    — leave as-is for now

If you reply 'remind', I'll send a brief reminder to non-responders only.
```

## Step 4 — Log

```sql
INSERT INTO command_log (source, name, status, summary)
VALUES ('scheduled_task', 'form-response-chase', 'success',
        'Sent low-response alert to operator for meeting=<id>: <responded>/<total>');
```
