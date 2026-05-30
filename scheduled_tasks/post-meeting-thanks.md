---
schedule: daily
description: Send thank-you note day after each meeting; reading_group needs leader's 1-line addition
---

# scheduled_tasks/post-meeting-thanks

Two paths: reading_group (leader-augmented) vs admin (auto-sent).

## Step 1 — Find recently-completed meetings

```sql
SELECT m.id, m.type, m.scheduled_at, m.paper_id, m.leader_id,
       p.title AS paper_title,
       leader.name AS leader_name, leader.email AS leader_email
FROM meetings m
LEFT JOIN papers p ON p.id = m.paper_id
LEFT JOIN members leader ON leader.id = m.leader_id
WHERE m.status='done'
  AND m.scheduled_at >= now() - interval '36 hours'
  AND m.scheduled_at <  now() - interval '24 hours';
```

(Catches meetings that auto-advanced to done in the past day.)

## Step 2 — Idempotency

For each, check if thanks were already sent — keyed on the exact
`idempotency_key` written in Step 4 (no brittle `summary LIKE` scan):
```sql
SELECT 1 FROM command_log
WHERE idempotency_key = 'post-meeting-thanks:meeting=<id>'
LIMIT 1;
```
Skip if a row exists. The check is status-agnostic on purpose: once a meeting
has been handled — whether the send went out clean or as the `partial`
leader-no-reply fallback (Step 3b) — it must not be re-thanked. The
`command_log_idempotency_key_unique` index is the race backstop (a concurrent
duplicate INSERT trips SQLSTATE 23505 — treat as already-sent).

## Step 3a — type='admin': auto-send

Recipients: active members.

Subject: `WiDS NYC: admin meeting recap`

Body (DB-driven):
```
Hi everyone,

Thanks for the admin meeting on <scheduled_at>!

Here's where we landed:
  Next reading group: <upcoming_rg.scheduled_at if known else "date being finalized">
  Leader: <upcoming_rg.leader.name if set else "TBD">
  Paper: <upcoming_rg.paper.title if set else "leader is hunting">

I'll be in touch with reminders as we get closer.
```

Send via Gmail MCP. Log success.

## Step 3b — type='reading_group': leader-augmented

Email the leader first:
```
Subject: WiDS NYC: thank-you note draft (please add 1 line)

Hi <leader_name>,

Quick favor — for the post-meeting thanks email going out today,
add ONE line about something specific from the discussion (e.g.,
"the embedding ablation conversation got really animated"). Reply
with your line and I'll merge it in and send.

Draft so far:
---
Hi everyone,

Thanks for joining last night's reading group on "<paper_title>" led by <leader_name>.

[YOUR 1-LINE ADDITION HERE]

The next reading group is being planned. More soon.
---
```

When leader replies (a separate step in the workflow — V1 may require this to be a manual operator action, since the scheduled task can't easily wait for a reply mid-run), build the final email with the leader's line slotted in and send to active members.

(For V1: if leader doesn't reply within 24h, send the draft as-is with `[YOUR 1-LINE ADDITION HERE]` placeholder removed. Log this as `partial`.)

## Step 4 — Log

```sql
INSERT INTO command_log (source, name, status, summary, idempotency_key, metadata)
VALUES ('scheduled_task', 'post-meeting-thanks', 'success',
        'Sent thanks for meeting=<id> type=<type>',
        'post-meeting-thanks:meeting=<id>',
        jsonb_build_object('meeting_id', <id>, 'meeting_type', '<type>'));
```
The `partial` leader-no-reply fallback (Step 3b) logs the **same**
`idempotency_key` (`'post-meeting-thanks:meeting=<id>'`) so the status-agnostic
Step-2 check blocks a later duplicate. Only one row per meeting can carry this
key — the unique index enforces it.
