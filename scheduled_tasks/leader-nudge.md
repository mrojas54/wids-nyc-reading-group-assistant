---
schedule: daily
description: Email leader directly when paper not picked, guide not drafted, or packets not sent
---

# scheduled_tasks/leader-nudge

Three nudge conditions. Fires at most once per 5 days per leader per condition. CC operator on the third.

## Conditions and queries

### Condition 1: paper not picked
```sql
SELECT m.id, m.leader_id, leader.name, leader.email,
       admin.scheduled_at AS admin_done_at
FROM meetings m
JOIN members leader ON leader.id = m.leader_id
JOIN meetings admin ON admin.id = m.planned_by_admin_id
WHERE m.type='reading_group' AND m.status='prep'
  AND m.paper_id IS NULL
  AND admin.status='done'
  AND admin.scheduled_at < now() - interval '7 days';
```

### Condition 2: guide not drafted
```sql
SELECT m.id, m.leader_id, leader.name, leader.email,
       m.scheduled_at, m.drive_folder_url
FROM meetings m
JOIN members leader ON leader.id = m.leader_id
WHERE m.type='reading_group' AND m.status='scheduled'
  AND m.scheduled_at >= now() + interval '7 days'
  AND m.scheduled_at <  now() + interval '14 days';
```

For each, check Drive folder for `members-packet.pdf` via Drive MCP. If missing → nudge.

### Condition 3: packets not sent
```sql
SELECT m.id, m.leader_id, leader.name, leader.email
FROM meetings m
JOIN members leader ON leader.id = m.leader_id
WHERE m.type='reading_group' AND m.status='scheduled'
  AND m.scheduled_at >= now() + interval '0 days'
  AND m.scheduled_at <  now() + interval '7 days'
  AND m.packets_sent_at IS NULL;
```

## Idempotency check (per condition per leader)

```sql
SELECT MAX(ran_at) FROM command_log
WHERE name='leader-nudge'
  AND summary LIKE '%leader=<leader_id>%condition=<n>%'
  AND status='success';
```
If <5 days, skip.

## Email templates

### Condition 1
```
Subject: WiDS NYC: time to pick a paper

Hi <leader_name>,

It's been a week since the admin meeting and the next reading group is
coming up. When you have a moment, run `/wids-find-paper search "<topic>"`
in Claude Code to start hunting for a paper. Or pop in some URLs you're
considering with `/wids-find-paper compare <url1> <url2>`.

No rush, just a friendly heads up.
```

### Condition 2
```
Subject: WiDS NYC: time to draft the discussion guide

Hi <leader_name>,

Reading group is in <X> days. Run `/wids-make-guide` to generate the
members' packet and your leader's packet (which has the timed agenda
and facilitation notes you'll want to review beforehand).
```

### Condition 3 (CC operator)
```
Subject: WiDS NYC: send the discussion guide to members

Hi <leader_name>,

Reading group is in <X> days and the members' packet hasn't gone out yet.
Run `/wids-send-packets` to create the email draft, then send from Gmail.

(<operator_name> is CC'd on this so they're aware.)
```

## Log

```sql
INSERT INTO command_log (source, name, status, summary)
VALUES ('scheduled_task', 'leader-nudge', 'success',
        'Nudged leader=<leader_id> condition=<n>');
```
