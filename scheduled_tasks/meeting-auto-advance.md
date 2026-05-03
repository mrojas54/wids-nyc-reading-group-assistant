---
schedule: daily
description: Mark meetings done 24h after scheduled_at passes
---

# scheduled_tasks/meeting-auto-advance

Runs daily. Trivial bookkeeping.

## Step 1 — Update

```sql
UPDATE meetings
SET status='done'
WHERE status='scheduled'
  AND scheduled_at < now() - interval '24 hours';
```

## Step 2 — Log

```sql
INSERT INTO command_log (source, name, status, summary)
VALUES ('scheduled_task', 'meeting-auto-advance', 'success',
        'Auto-advanced N meetings to done');
```

If 0 rows updated, log status='no_action' instead of 'success'.
