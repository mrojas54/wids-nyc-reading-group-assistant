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
has been handled — whether the send went out clean or as the degraded
leader-no-reply fallback (Step 3b) — it must not be re-thanked. The
`command_log_idempotency_key_unique` index is the race backstop (a concurrent
duplicate INSERT trips SQLSTATE 23505 — treat as already-sent).

The index is partial (`WHERE idempotency_key IS NOT NULL`), so the daily
`no_action` rows — which carry a NULL key — never collide with each other.

**This key means "members have been emailed," not "the run did something."** The
reading_group path (Step 3b) touches a meeting across two runs and writes a
*different* key on the first one; only the run that actually sends to members
writes `post-meeting-thanks:meeting=<id>`. Writing this key when nothing was
sent would permanently suppress the send.

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

This path spans **two runs**: one to ask the leader for their line, a later one
to send. The two are told apart by which idempotency key already exists for the
meeting — the task holds no state between runs beyond `command_log`.

### 3b-i — first run: draft to the leader

Guard (distinct from the Step 2 key):
```sql
SELECT 1 FROM command_log
WHERE idempotency_key = 'post-meeting-thanks:leader-draft:meeting=<id>'
LIMIT 1;
```
If a row exists, skip to 3b-ii. Otherwise create a Gmail **draft** to the leader
— a draft, never a send, on every path. Members get nothing on this run.
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

Then log the draft under the **leader-draft** key. Note what this row does *not*
write: the Step 2 key. No email has gone to members yet, and claiming that key
here would make Step 2 skip the meeting on every later run — the draft would sit
in Gmail and members would never be thanked.

```sql
INSERT INTO command_log (source, name, status, summary, idempotency_key, metadata)
VALUES ('scheduled_task', 'post-meeting-thanks', 'success',
        'Leader draft created for meeting=<id>, awaiting leader line',
        'post-meeting-thanks:leader-draft:meeting=<id>',
        jsonb_build_object('meeting_id', <id>, 'meeting_type', 'reading_group',
                           'awaiting_leader_line', true, 'emails_sent', 0));
```
`status='success'` because the drafting action succeeded; `emails_sent: 0` is
what records that nothing went out.

### 3b-ii — later run: send, with or without the leader's line

Reached when the leader-draft row exists but the Step 2 key still does not. Age
the draft:
```sql
SELECT ran_at FROM command_log
WHERE idempotency_key = 'post-meeting-thanks:leader-draft:meeting=<id>';
```

**Under 24h** — the leader still has time. Do nothing, and write **no row at
all** for this meeting; report it as pending in the run summary. A row here
would be noise at best, and a Step 2 key would suppress tomorrow's send.

**24h or older** — the V1 fallback below.

If the operator merged a leader reply by hand and sent the good version, they
will have written the Step 2 key themselves, so Step 2 skips the meeting and
this fallback never fires. That interaction is the design, not a race.

### V1 fallback — leader never replied

Send the draft to active members with the `[YOUR 1-LINE ADDITION HERE]`
placeholder line removed.

The email still went out, so this degraded send is logged with `status='success'`
— the same valid status as a clean send (the only difference is the missing
leader line). `command_log.status` is CHECK-constrained to
`('success', 'failure', 'no_action')`, so there is no `partial` status to use;
`no_action` would be wrong (an email *was* sent) and `failure` would be wrong (it
succeeded). Write the **same** `idempotency_key` as a clean send (so the
status-agnostic Step 2 check still blocks a re-send), and record the degraded
nature with a `metadata.degraded` flag — that is the only thing distinguishing
this row from a clean Step 4 send:

```sql
INSERT INTO command_log (source, name, status, summary, idempotency_key, metadata)
VALUES ('scheduled_task', 'post-meeting-thanks', 'success',
        'Sent thanks for meeting=<id> type=reading_group (leader line missing)',
        'post-meeting-thanks:meeting=<id>',
        jsonb_build_object('meeting_id', <id>, 'meeting_type', 'reading_group',
                           'degraded', 'leader_no_reply'));
```

On the `/admin/logs` page this renders as `info` severity (see
`deriveSeverity` in `web/lib/logs.ts`: `success→info`), which is the right signal
— the send succeeded, it was just missing the leader's one-line addition.

## Step 4 — Log

```sql
INSERT INTO command_log (source, name, status, summary, idempotency_key, metadata)
VALUES ('scheduled_task', 'post-meeting-thanks', 'success',
        'Sent thanks for meeting=<id> type=<type>',
        'post-meeting-thanks:meeting=<id>',
        jsonb_build_object('meeting_id', <id>, 'meeting_type', '<type>'));
```
The degraded leader-no-reply fallback (Step 3b) logs the **same**
`idempotency_key` (`'post-meeting-thanks:meeting=<id>'`) so the status-agnostic
Step-2 check blocks a later duplicate. Only one row per meeting can carry this
key — the unique index enforces it; the fallback is told apart only by its
`metadata.degraded` flag.

When Step 1 returns nothing — the common case on most days — log one `no_action`
row with a NULL key:

```sql
INSERT INTO command_log (source, name, status, summary, idempotency_key, metadata)
VALUES ('scheduled_task', 'post-meeting-thanks', 'no_action',
        'No meetings wrapped 24-36h ago',
        NULL,
        jsonb_build_object('window_matches', 0, 'emails_sent', 0,
                           'reason', 'no_meetings_in_window'));
```

### Key inventory

Three keys, and only the second one means "members were emailed":

| Key | Written by | Meaning |
|-----|-----------|---------|
| `post-meeting-thanks:leader-draft:meeting=<id>` | 3b-i | Leader draft exists; clock started. Does **not** block the send. |
| `post-meeting-thanks:meeting=<id>` | Step 4, the 3b-ii fallback, or a manual operator send | Members were emailed. Blocks everything further for this meeting. |
| `NULL` | the `no_action` row | Nothing qualified. Exempt from the unique index, so it repeats daily. |

## Schema facts

Verified 2026-08-05 against project `dmyulakudbdegwkqgelx`. These have bitten
past runs, so check here before writing a new `command_log` insert:

- The timestamp column is **`ran_at`**, not `created_at`. A `RETURNING created_at`
  aborts the whole insert.
- `status` CHECK: `('success', 'failure', 'no_action')` — no `partial`.
- `source` CHECK: `('slash_command', 'scheduled_task', 'server_action')`.
- `metadata` is `jsonb NOT NULL DEFAULT '{}'`. It has a default, so an insert
  omitting it succeeds — but pass it explicitly so rows carry real context.
- `command_log_idempotency_key_unique` is a **partial** unique index
  (`WHERE idempotency_key IS NOT NULL`). A duplicate trips SQLSTATE 23505 —
  treat that as "already handled," not as a failure.
