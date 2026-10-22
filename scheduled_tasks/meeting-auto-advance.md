---
schedule: daily
description: Mark meetings done 24h after scheduled_at passes
---

# scheduled_tasks/meeting-auto-advance

Runs daily. Trivial bookkeeping.

## Step 1 — Advance, capturing count and ids

```sql
WITH advanced AS (
  UPDATE meetings
  SET status='done'
  WHERE status='scheduled'
    AND scheduled_at < now() - interval '24 hours'
  RETURNING id
)
SELECT count(*) AS n, array_agg(id) AS ids FROM advanced;
```

## Step 2 — Log

If `n > 0`:

```sql
INSERT INTO command_log (source, name, status, summary, metadata)
VALUES ('scheduled_task', 'meeting-auto-advance', 'success', 'Auto-advanced N meetings to done: <ids>',
        jsonb_build_object('advanced_count', <n>, 'meeting_ids', <ids_json_array>));
```

If `n = 0`:

```sql
INSERT INTO command_log (source, name, status, summary, metadata)
VALUES ('scheduled_task', 'meeting-auto-advance', 'no_action', '0 meetings to advance',
        jsonb_build_object('advanced_count', 0, 'reason', 'none_past_due'));
```

Always pass `metadata` explicitly. The column is `jsonb NOT NULL DEFAULT
'{}'::jsonb` (migration 020), so omitting it does not fail the insert — it
writes an empty object, leaving a row nobody can filter on `advanced_count`.
These are the statements the registered task
(`~/.claude/scheduled-tasks/wids-meeting-auto-advance/SKILL.md`) actually runs.
