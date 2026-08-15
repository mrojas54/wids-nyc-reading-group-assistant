---
schedule: daily
description: Draft thank-you note day after each meeting (operator sends); reading_group needs leader's 1-line addition
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
  AND m.scheduled_at <  now() - interval '24 hours'
  AND m.scheduled_at >= now() - interval '7 days'
  AND NOT EXISTS (
        SELECT 1 FROM command_log cl
        WHERE cl.idempotency_key = 'post-meeting-thanks:meeting=' || m.id)
ORDER BY m.scheduled_at;
```

The 24h lower bound is the "day after the meeting" intent. The 7-day upper bound
is **slack, not scheduling** — what bounds the work is the `NOT EXISTS` filter,
which folds the Step 2 key check into the scan so a wide window still cannot
re-thank an already-thanked meeting. Step 2 still runs per meeting as the race
backstop.

Meetings with `scheduled_at IS NULL` (a few legacy `admin` rows) never match, since
NULL comparisons are false. They are out of scope by construction, not by accident.

**Safety cap: if this query returns more than 2 rows, stop and report instead of
sending.** This task emails every active member, and a fortnightly cadence puts at
most one meeting in a 7-day window. More than that means something upstream is
wrong — a bulk status edit, a restored backup — and a blast to the whole roster is
not how that should be discovered.

### Why 7 days and not 36 hours

The 36h ceiling was the bug. A meeting only becomes `done` when
`meeting-auto-advance` first runs at least 24h after `scheduled_at`, and daily runs
are 24h apart, so a meeting is somewhere between 24h and 48h old the first time it
is visible here. A 24–36h window covered only the first half of that range.

Reading groups meet at 18:30 ET and the daily tasks run mid-morning, which put
every reading group at ~38h old — three hours past the ceiling — on the first run
that could have seen it, and outside the window forever after. The result was not a
delayed email but no email: as of 2026-08-15, `command_log` had never once written
a `post-meeting-thanks:meeting=<id>` key, across 21 completed meetings going back to
2024-11-05. Meeting #37 (2026-08-13) was thanked only via a manual catch-up.

7 days is far wider than any plausible slack (a missed run, a weekend, a laptop that
was closed) while still short enough that no historical meeting can re-enter scope:
when this was changed, the next-oldest unthanked `done` meeting was 56 days back, so
the widened window needed no backfill suppression rows to stay safe. A meeting that
goes unthanked for a full week drops out permanently, which is deliberate — a
thank-you that arrives eight days late is worse than none. Note the filter is on
`scheduled_at`, not on when the row became `done`, so marking an old meeting `done`
today does not drag it back into scope.

## Step 2 — Idempotency

Step 1's `NOT EXISTS` already filters these out, so in a healthy run this check is
redundant — keep it anyway. It is what makes the window width a performance
question rather than a correctness one, and it closes the gap between Step 1's scan
and the send.

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
*different* key on the first one; only the run that actually drafts to members
writes `post-meeting-thanks:meeting=<id>`. Writing this key when nothing was
sent would permanently suppress the send.

## Step 3a — type='admin': draft the recap

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

**Draft it, do not send it.** Create one Gmail draft addressed to the active
members and leave it for the operator to send — see "Do not add a send path"
below. Log with `status='needs_action'` per Step 4.

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
VALUES ('scheduled_task', 'post-meeting-thanks', 'needs_action',
        'Leader draft created for meeting=<id>, awaiting operator send then leader line',
        'post-meeting-thanks:leader-draft:meeting=<id>',
        jsonb_build_object('meeting_id', <id>, 'meeting_type', 'reading_group',
                           'awaiting_leader_line', true,
                           'operator_action_required', true, 'emails_sent', 0));
```
`needs_action`, not `success`: the draft cannot reach the leader until the operator
sends it, so this row is a request directed at them and belongs in amber on
`/admin/logs`. `emails_sent: 0` records that nothing went out.

**Known limitation in the clock.** 3b-ii ages this row from its `ran_at` — when the
draft was *created* — because the task cannot observe when the operator actually
sends it. If the leader draft sits unsent for more than a day, the 24h fallback
fires and drafts the members' thanks with the placeholder stripped, pre-empting a
leader who never had a chance to reply. The practical rule: send the leader draft
the day it appears, or expect the un-augmented version. Closing this properly needs
a signal the task can read (an operator-flipped flag, or a reply-detection pass) —
it must not be closed by giving the task send capability.

### 3b-ii — later run: draft to members, with or without the leader's line

Reached when the leader-draft row exists but the Step 2 key still does not.

This path depends entirely on the meeting still being in Step 1's window a day
after its own leader draft was written. Under the old 36h ceiling it never was,
which made this whole section dead code — the draft would sit in Gmail and members
would never hear anything. The 7-day window is what makes it reachable, and it
gives the leader roughly six days to reply rather than a single run.

Age the draft:
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

Create the members' Gmail draft with the `[YOUR 1-LINE ADDITION HERE]` placeholder
line removed. **Draft, not send** — the operator presses send, exactly as on the
clean path.

Write the **same** `idempotency_key` as a clean run (so the status-agnostic Step 2
check still blocks a duplicate), and record the degraded nature with a
`metadata.degraded` flag — that is the only thing distinguishing this row from a
clean Step 4 row:

```sql
INSERT INTO command_log (source, name, status, summary, idempotency_key, metadata)
VALUES ('scheduled_task', 'post-meeting-thanks', 'needs_action',
        'Members draft ready for meeting=<id> type=reading_group (leader line missing)',
        'post-meeting-thanks:meeting=<id>',
        jsonb_build_object('meeting_id', <id>, 'meeting_type', 'reading_group',
                           'degraded', 'leader_no_reply',
                           'operator_action_required', true,
                           'recipients', <n>, 'drafts_created', 1, 'emails_sent', 0));
```

On `/admin/logs` this renders as `warn` severity (see `deriveSeverity` in
`web/lib/logs.ts`: `needs_action→warn`), which is the right signal — a draft is
sitting in the operator's mailbox waiting on them, and amber is what surfaces it.

## Step 4 — Log

```sql
INSERT INTO command_log (source, name, status, summary, idempotency_key, metadata)
VALUES ('scheduled_task', 'post-meeting-thanks', 'needs_action',
        'Members draft ready for meeting=<id> type=<type>',
        'post-meeting-thanks:meeting=<id>',
        jsonb_build_object('meeting_id', <id>, 'meeting_type', '<type>',
                           'operator_action_required', true,
                           'recipients', <n>, 'drafts_created', 1, 'emails_sent', 0));
```
`needs_action` rather than `success` because the run's own work finished but the
message has not reached anyone — a human still has to press send. It derives to
`warn` on `/admin/logs`, so a forgotten draft shows up amber instead of hiding
inside a green "success" row. Reserve `success` for a run that needed nothing
from the operator.

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
        'No unthanked meetings in the 24h-7d window',
        NULL,
        jsonb_build_object('window_matches', 0, 'emails_sent', 0,
                           'reason', 'no_meetings_in_window'));
```

### Key inventory

Three keys, and only the second one means "the members' message has been handed
off":

| Key | Written by | Meaning |
|-----|-----------|---------|
| `post-meeting-thanks:leader-draft:meeting=<id>` | 3b-i | Leader draft exists; clock started. Does **not** block the members' draft — Step 1 deliberately filters on the second key only, so the meeting stays in scope for 3b-ii. |
| `post-meeting-thanks:meeting=<id>` | Step 4, the 3b-ii fallback, or a manual operator send | The members' draft exists (or the operator already sent). Blocks everything further for this meeting. |
| `NULL` | the `no_action` row | Nothing qualified. Exempt from the unique index, so it repeats daily. |

Note the second key is claimed when the **draft** is created, not when the mail
goes out — the task cannot observe the send, since a human performs it. That is
the correct trade: the failure it must prevent is drafting the same thanks twice,
and an unsent draft stays visible as an amber `needs_action` row on `/admin/logs`.

## Schema facts

Re-verified 2026-08-15 against project `dmyulakudbdegwkqgelx`. These have bitten
past runs, so check here before writing a new `command_log` insert:

- The timestamp column is **`ran_at`**, not `created_at`. A `RETURNING created_at`
  aborts the whole insert.
- `status` CHECK: `('success', 'failure', 'no_action', 'needs_action')` — no
  `partial`. `needs_action` was added by
  [migration 029](../migrations/029_command_log_needs_action_status.sql) and is the
  correct status for "a draft is waiting on the operator."
- `source` CHECK: `('slash_command', 'scheduled_task', 'server_action')`.
- `metadata` is `jsonb NOT NULL DEFAULT '{}'`. It has a default, so an insert
  omitting it succeeds — but pass it explicitly so rows carry real context.
- `command_log_idempotency_key_unique` is a **partial** unique index
  (`WHERE idempotency_key IS NOT NULL`). A duplicate trips SQLSTATE 23505 —
  treat that as "already handled," not as a failure.

## Do not add a send path — this is policy, not a limitation

**The operator has ruled that nothing in this repo may send email as them.** Every
member-facing message is drafted and a human presses send. That is the intended
design, not a capability gap waiting on someone to wire a sender. The same rule
governs [`pre-meeting-reminder.md`](pre-meeting-reminder.md) and
[`docs/runbooks/transactional-emails.md`](../docs/runbooks/transactional-emails.md).

Until 2026-08-15 this spec said "send" in Step 3a and in the 3b-ii fallback. That
was an oversight, not an exemption — the policy commit that reframed the other
specs simply missed this file. The wording had never caused a wrongful send only
because the 36h window bug meant neither path had ever executed. Fixing that window
made both paths live, which is why they were converted to drafts in the same change.

Those send routes are technically reachable — Composio catalogues
`GMAIL_SEND_EMAIL` and `GMAIL_SEND_DRAFT`, and the Gmail MCP may expose a
`send_message` tool. **Reachable is not permitted.** A future run that finds a send
tool available must not read availability as permission. Only the operator can
change this, in their own words.
