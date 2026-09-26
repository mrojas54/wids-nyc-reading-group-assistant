---
schedule: weekly
description: Detect cycles that have gone quiet and email operator to suggest restart
---

# scheduled_tasks/cycle-keep-alive

Runs **weekly** (Mondays). Notifies the operator only when the group has been
quiet for **3+ months** *and* nothing is on the books.

The bar is deliberately high. A month or two of quiet is a normal summer, not a
stall — this task exists to catch a group that has genuinely gone dormant, not
to keep pace with the cycle.

> **Note (migration 002):** This task is operator-facing only — it nudges the operator to restart a stalled cycle and never emails members. Member-facing availability collection moved from Google Forms to the portal at `https://wids-nyc-reading-group-assistant.vercel.app/availability` (see `availability-chase` for that path); this task is unaffected by the cutover.

## Step 1 — When did the group last actually meet?

Any completed meeting counts as a meetup, admin or reading_group — an admin
meeting means the group is alive.

```sql
SELECT
  MAX(scheduled_at) FILTER (WHERE type IN ('reading_group','admin')) AS last_meetup,
  MAX(scheduled_at) FILTER (WHERE type = 'reading_group')            AS last_rg
FROM meetings
WHERE status = 'done';
```

## Step 2 — Is anything on the books?

A meeting counts as on-the-books if it is `scheduled`, or if it is in `prep`
and genuinely moving — meaning it has a date, or it was created recently enough
that availability collection is plausibly still underway.

A `prep` row with no `scheduled_at` that has sat untouched for 21+ days is
**stalled, not in flight**, and must not suppress the nudge.

```sql
SELECT count(*) AS on_the_books
FROM meetings
WHERE type IN ('admin','reading_group')
  AND (
        status = 'scheduled'
     OR (status = 'prep' AND (
              scheduled_at IS NOT NULL
           OR created_at > now() - interval '21 days'
        ))
  );
```

## Step 3 — Decide

Nudge only if **both** are true. Anything else logs `no_action` and exits.

| Condition | Action |
|---|---|
| `last_meetup` IS NULL and `on_the_books` = 0 | `no_action` — kickoff state, bootstrap owns cycle 1. Don't nag. |
| `on_the_books` > 0 | `no_action` — something is already moving. |
| `last_meetup` >= `now() - interval '3 months'` | `no_action` — the group met recently enough. |
| `on_the_books` = 0 **and** `last_meetup` < `now() - interval '3 months'` | Send the nudge (Step 4). |

## Step 3.5 — Idempotency

Once the group is dormant the trigger stays true every week, so cap the nudge
rate independently of the check rate: **check weekly, nudge at most every 28
days.**

```sql
SELECT MAX(ran_at) AS last_nudge FROM command_log
WHERE name = 'cycle-keep-alive' AND status = 'success'
  AND summary LIKE '%Sent nudge%';
```

If `last_nudge > now() - interval '28 days'` → log `no_action` and exit.

## Step 4 — Send nudge email

Recipient: operator (`SELECT name, email FROM members WHERE role='operator'`)

Subject: "WiDS NYC: time to start the next cycle?"

Body:
```
Hi <operator_name>,

The last WiDS NYC meetup was on <last_meetup date>, about <N> months ago, and
there's nothing on the calendar right now.

If you'd like to start the next cycle, run `/wids-meeting-start admin` in
Claude Code. No reply needed — if you're just taking a break, ignore this and
I'll check again in four weeks.
```

Don't promise a reply-based snooze. Nothing reads replies to this address; the
28-day cap in Step 3.5 *is* the snooze.

## Step 5 — Log

`command_log.metadata` is `jsonb NOT NULL` **with no default** — an insert that
omits it fails. Always supply it, on both the nudge and `no_action` paths.

```sql
INSERT INTO command_log (source, name, status, summary, metadata)
VALUES (
  'scheduled_task', 'cycle-keep-alive', 'success',
  'Sent nudge to operator',
  jsonb_build_object(
    'last_meetup', <last_meetup>,
    'months_since_last_meetup', <n>,
    'on_the_books', 0,
    'decision', 'nudged',
    'emails_sent', 1
  )
);
```

For a `no_action` run, record which gate stopped it — `reason` should be one of
`kickoff`, `on_the_books_nonzero`, `met_within_3_months`, or `nudge_within_28_days`.
