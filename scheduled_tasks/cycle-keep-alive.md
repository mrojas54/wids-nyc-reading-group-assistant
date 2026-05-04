---
schedule: daily
description: Detect cycles that have stalled and email operator to suggest restart
---

# scheduled_tasks/cycle-keep-alive

Runs daily. Notifies operator if no cycle has been started in 28+ days.

> **Note (migration 002):** This task is operator-facing only — it nudges the operator to restart a stalled cycle and never emails members. Member-facing availability collection moved from Google Forms to the portal at `${PORTAL_URL}/availability` (see `availability-chase` for that path); this task is unaffected by the cutover.

## Step 1 — Check most recent reading_group

```sql
SELECT MAX(scheduled_at) AS last_rg
FROM meetings
WHERE type='reading_group' AND status='done';
```

## Step 2 — Check for in-progress cycle

```sql
SELECT count(*) FROM meetings
WHERE status IN ('prep','scheduled') AND type IN ('admin','reading_group');
```

## Step 3 — Decide

- If `last_rg` is NULL (no completed reading group ever) AND no in-progress cycle:
  - This is the kickoff state. Don't nag — bootstrap should have started cycle 1.
  - Log `no_action`. Exit.
- If `last_rg` >= 28 days ago AND no in-progress cycle:
  - Send email. (Step 4.)
- Otherwise:
  - Log `no_action`. Exit.

## Step 4 — Send nudge email

Recipient: operator (`SELECT email FROM members WHERE role='operator'`)

Subject: "WiDS NYC: time to start the next cycle?"

Body:
```
Hi <operator_name>,

It's been 28+ days since the last reading group on <last_rg date>. No new
cycle is in progress.

If you'd like to start the next one, run `/wids-meeting-start admin` in
Claude Code. Or just reply 'snooze' here and I'll wait another week.
```

## Step 5 — Log

```sql
INSERT INTO command_log (source, name, status, summary)
VALUES ('scheduled_task', 'cycle-keep-alive', 'success', 'Sent nudge to operator');
```

## Idempotency

Tracks last sent timestamp by querying:
```sql
SELECT MAX(ran_at) FROM command_log
WHERE name='cycle-keep-alive' AND status='success' AND summary LIKE '%Sent nudge%';
```
If last successful nudge was <7 days ago, skip (don't re-spam). Log `no_action`.
